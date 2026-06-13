// Deploy the ContentModeration contract to GenLayer Testnet Bradbury using
// genlayer-js, then print the resulting contract address so you can paste it
// into .env as VITE_GENLAYER_CONTRACT_ADDRESS.
//
// Usage (from project root):
//   node scripts/deploy.mjs
//
// Requires GENLAYER_PRIVATE_KEY in your environment (.env). The account must be
// funded on Bradbury: https://testnet-faucet.genlayer.foundation
//
// Note: this performs a REAL on-chain deployment and spends testnet GEN.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', 'contract', 'content_moderation.py');
const TOPIC = process.env.MODERATION_TOPIC ?? 'GenLayer and blockchain development';

function loadDotEnv() {
  // Minimal .env loader so we don't add a dependency just for deployment.
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env file — rely on the ambient environment.
  }
}

async function main() {
  loadDotEnv();

  const key = process.env.GENLAYER_PRIVATE_KEY;
  if (!key) {
    console.error('ERROR: GENLAYER_PRIVATE_KEY is not set (.env or environment).');
    process.exit(1);
  }

  const account = createAccount(key.startsWith('0x') ? key : `0x${key}`);
  const client = createClient({ chain: testnetBradbury, account });

  const code = readFileSync(CONTRACT_PATH, 'utf-8');

  console.log('Deploying ContentModeration to Testnet Bradbury…');
  console.log(`  deployer: ${account.address}`);
  console.log(`  topic:    "${TOPIC}"`);

  const txHash = await client.deployContract({
    code,
    args: [TOPIC],
  });
  console.log(`  tx hash:  ${txHash}`);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: 'ACCEPTED',
  });

  // Deep search the receipt for a contract address field (shape varies by SDK
  // version). Handles BigInt safely.
  const address = findContractAddress(receipt);

  console.log('\nDeployment accepted.');
  if (address) {
    console.log('\nAdd this to your .env:');
    console.log(`VITE_GENLAYER_CONTRACT_ADDRESS="${address}"`);
  } else {
    console.log('Could not auto-detect the address. Full receipt:');
    console.log(stringifySafe(receipt));
  }
}

// JSON.stringify that tolerates BigInt values.
function stringifySafe(obj) {
  return JSON.stringify(
    obj,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
}

// Recursively look for the deployed contract address under common key names.
function findContractAddress(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  const keys = [
    'contract_address',
    'contractAddress',
    'created_contract',
    'recipient',
    'address',
    'to',
  ];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return v;
  }
  for (const v of Object.values(obj)) {
    const found = findContractAddress(v, depth + 1);
    if (found) return found;
  }
  return null;
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
