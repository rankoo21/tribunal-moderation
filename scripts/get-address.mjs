// Fetch the deployed contract address from an existing deployment tx hash,
// so we don't have to redeploy. Usage:
//   node scripts/get-address.mjs 0x<txHash>

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

function stringifySafe(obj) {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

function findContractAddress(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  const keys = ['contract_address', 'contractAddress', 'created_contract', 'address', 'to'];
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

async function main() {
  loadDotEnv();
  const hash = process.argv[2];
  if (!hash) {
    console.error('Usage: node scripts/get-address.mjs 0x<txHash>');
    process.exit(1);
  }

  const key = process.env.GENLAYER_PRIVATE_KEY;
  const account = createAccount(key.startsWith('0x') ? key : `0x${key}`);
  const client = createClient({ chain: testnetBradbury, account });

  const tx = await client.getTransaction({ hash });
  const address = findContractAddress(tx);

  if (address) {
    console.log('\nDeployed contract address:');
    console.log(`VITE_GENLAYER_CONTRACT_ADDRESS="${address}"`);
  } else {
    console.log('Address not found in transaction. Full transaction:');
    console.log(stringifySafe(tx));
  }
}

main().catch((err) => {
  console.error('Lookup failed:', err);
  process.exit(1);
});
