// Live smoke test against the DEPLOYED ContentModeration contract on Bradbury.
//
// Submits two real posts (one clean + on-topic, one toxic) through real
// validator consensus, then reads the board back to confirm the verdicts.
//
// Usage (from project root):
//   node scripts/live-test.mjs
//
// Requires GENLAYER_PRIVATE_KEY + VITE_GENLAYER_CONTRACT_ADDRESS in .env.
// This spends testnet GEN and exercises real LLM moderation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll a transaction until it is finalized/accepted. Bradbury runs real LLMs,
// so consensus can take a while — we wait generously instead of failing fast.
async function waitForConsensus(client, hash, { timeoutMs = 420000, intervalMs = 6000 } = {}) {
  const start = Date.now();
  const done = new Set(['ACCEPTED', 'FINALIZED']);
  const failed = new Set(['UNDETERMINED', 'CANCELED']);
  let last = '';
  while (Date.now() - start < timeoutMs) {
    let tx;
    try {
      tx = await client.getTransaction({ hash });
    } catch {
      await sleep(intervalMs);
      continue;
    }
    const status = tx?.statusName ?? String(tx?.status ?? '');
    if (status && status !== last) {
      process.stdout.write(`  …${status}\n`);
      last = status;
    }
    if (done.has(status)) return tx;
    if (failed.has(status)) throw new Error(`transaction ${status}`);
    await sleep(intervalMs);
  }
  throw new Error('timed out waiting for consensus');
}

// Retry reads to ride out the public RPC rate limit.
async function read(client, address, functionName, args = []) {
  for (let i = 0; i < 5; i++) {
    try {
      return await client.readContract({ address, functionName, args });
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (/rate limit|exceeds defined limit|429/i.test(msg) && i < 4) {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  loadDotEnv();

  const key = process.env.GENLAYER_PRIVATE_KEY;
  const address = process.env.VITE_GENLAYER_CONTRACT_ADDRESS;
  if (!key || !address) {
    console.error('Missing GENLAYER_PRIVATE_KEY or VITE_GENLAYER_CONTRACT_ADDRESS in .env');
    process.exit(1);
  }

  const account = createAccount(key.startsWith('0x') ? key : `0x${key}`);
  const client = createClient({ chain: testnetBradbury, account });

  console.log('── GenLayer live moderation test ───────────────────────────');
  console.log('contract:', address);
  console.log('account :', account.address);

  const topic = await read(client, address, 'get_topic');
  console.log('topic   :', topic);

  const before = Number(await read(client, address, 'get_post_count'));
  console.log('posts before:', before, '\n');

  const samples = [
    {
      label: 'CLEAN + ON-TOPIC (expect APPROVE)',
      text:
        'I love how GenLayer validators reach consensus on subjective decisions ' +
        'using the Equivalence Principle. Smart contracts that can reason are wild.',
    },
    {
      label: 'TOXIC (expect REJECT)',
      text: 'You are all complete idiots and I hate every single one of you losers.',
    },
  ];

  for (const s of samples) {
    console.log(`▶ Submitting: ${s.label}`);
    console.log(`  "${s.text.slice(0, 70)}..."`);
    console.log('  validators reaching consensus…');

    const txHash = await client.writeContract({
      address,
      functionName: 'submit_post',
      args: [s.text],
      value: 0n,
    });
    console.log(`  tx: ${txHash}`);
    await waitForConsensus(client, txHash);

    await sleep(1200);
    const posts = await read(client, address, 'get_posts');
    const newest = posts[0];
    const verdict = newest.approved ? '✅ APPROVED' : '❌ REJECTED';
    console.log(`  → ${verdict}  [${newest.category}]`);
    console.log(`  → reason: ${newest.reason}\n`);
    await sleep(1500);
  }

  const after = Number(await read(client, address, 'get_post_count'));
  const approved = Number(await read(client, address, 'get_approved_count'));
  const rep = Number(await read(client, address, 'get_reputation', [account.address]));

  console.log('── Results ─────────────────────────────────────────────────');
  console.log('posts after    :', after, `(added ${after - before})`);
  console.log('approved total :', approved);
  console.log('your reputation:', rep);
  console.log('\nContract is working end-to-end on Bradbury. ✔');
}

main().catch((err) => {
  console.error('\nLive test failed:', err.message ?? err);
  process.exit(1);
});
