// GenLayer client + typed read/write helpers for the Content Moderation dApp.
//
// All configuration comes from Vite env vars (see .env / .env.example). Nothing
// is hardcoded. If a required value is missing we fail loudly so misconfigured
// builds are caught immediately instead of silently misbehaving.

import { createClient, createAccount } from 'genlayer-js';
import {
  testnetBradbury,
  testnetAsimov,
  studionet,
  localnet,
} from 'genlayer-js/chains';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const CHAINS = {
  'testnet-bradbury': testnetBradbury,
  'testnet-asimov': testnetAsimov,
  studionet,
  localnet,
};

const NETWORK = import.meta.env.VITE_GENLAYER_NETWORK ?? 'testnet-bradbury';
const CONTRACT_ADDRESS = import.meta.env.VITE_GENLAYER_CONTRACT_ADDRESS;
const RPC_URL = import.meta.env.VITE_GENLAYER_RPC_URL; // optional override
const ACCOUNT_KEY = import.meta.env.VITE_GENLAYER_ACCOUNT_PRIVATE_KEY; // optional

function requireConfig() {
  const chain = CHAINS[NETWORK];
  if (!chain) {
    throw new Error(
      `Unknown VITE_GENLAYER_NETWORK "${NETWORK}". ` +
        `Expected one of: ${Object.keys(CHAINS).join(', ')}.`,
    );
  }
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      'Missing VITE_GENLAYER_CONTRACT_ADDRESS. Deploy the contract and set it ' +
        'in your .env (see README → Deploy).',
    );
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Client (lazily created; can be rebuilt when a wallet connects)
// ---------------------------------------------------------------------------

let _client = null;
let _walletAccount = null; // address string when a browser wallet is connected
let _walletProvider = null; // EIP-1193 provider (window.ethereum)

// Build a fresh client. Priority for the signing account:
//   1. a connected browser wallet (address + provider), else
//   2. the dev key from .env (VITE_GENLAYER_ACCOUNT_PRIVATE_KEY), else
//   3. an ephemeral account (reads work; writes need funds).
function buildClient() {
  const chain = requireConfig();

  let account;
  let provider;

  if (_walletAccount && _walletProvider) {
    account = _walletAccount; // an Address string — signing goes through the wallet
    provider = _walletProvider;
  } else if (ACCOUNT_KEY) {
    const normalizedKey = ACCOUNT_KEY.startsWith('0x') ? ACCOUNT_KEY : `0x${ACCOUNT_KEY}`;
    account = createAccount(normalizedKey);
  } else {
    account = createAccount();
  }

  _client = createClient({
    chain,
    ...(RPC_URL ? { endpoint: RPC_URL } : {}),
    account,
    ...(provider ? { provider } : {}),
  });
  return _client;
}

export function getClient() {
  return _client ?? buildClient();
}

// Called by the UI after a successful wallet connection. Rebuilds the client so
// subsequent writes are signed by the connected wallet.
export function applyWalletAccount(address, provider) {
  _walletAccount = address;
  _walletProvider = provider;
  buildClient();
}

export function isWalletConnected() {
  return !!_walletAccount;
}

export function getConfig() {
  return {
    network: NETWORK,
    contractAddress: CONTRACT_ADDRESS,
    rpcUrl: RPC_URL ?? CHAINS[NETWORK]?.rpcUrls?.default?.http?.[0] ?? '(chain default)',
    account: getClient().account?.address ?? _walletAccount ?? null,
    wallet: isWalletConnected(),
  };
}

// ---------------------------------------------------------------------------
// Read helpers (call @gl.public.view methods — free, instant)
// ---------------------------------------------------------------------------

// Small helper: retry a read with backoff when the public RPC rate-limits us.
async function withRetry(fn, { tries = 4, delay = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const rateLimited = /rate limit|exceeds defined limit|429/i.test(msg);
      if (!rateLimited || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
  throw lastErr;
}

export async function readTopic() {
  return withRetry(() =>
    getClient().readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_topic',
      args: [],
    }),
  );
}

export async function readPosts() {
  // Returns newest-first list of { index, author, text, approved, category, reason }.
  const posts = await withRetry(() =>
    getClient().readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_posts',
      args: [],
    }),
  );
  return Array.isArray(posts) ? posts : [];
}

export async function readStats() {
  const client = getClient();
  // Sequential (not parallel) to stay under the public RPC rate limit.
  const total = await withRetry(() =>
    client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_post_count', args: [] }),
  );
  const approved = await withRetry(() =>
    client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_approved_count', args: [] }),
  );
  return { total: Number(total), approved: Number(approved) };
}

export async function readReputation(authorAddress) {
  const score = await withRetry(() =>
    getClient().readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_reputation',
      args: [authorAddress],
    }),
  );
  return Number(score);
}

// ---------------------------------------------------------------------------
// Write helper (calls @gl.public.write submit_post and waits for consensus)
// ---------------------------------------------------------------------------

export async function submitPost(text) {
  const client = getClient();

  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'submit_post',
    args: [text],
    value: 0n,
  });

  // Bradbury runs real LLMs, so consensus can take a few minutes and moves
  // through stages (PROPOSING → COMMITTING → ACCEPTED). We poll patiently
  // instead of relying on the SDK's short default timeout.
  const receipt = await waitForConsensus(client, txHash);
  return { txHash, receipt };
}

// Poll a transaction until it reaches a final consensus state.
async function waitForConsensus(client, hash, { timeoutMs = 420000, intervalMs = 6000 } = {}) {
  const start = Date.now();
  const done = new Set(['ACCEPTED', 'FINALIZED']);
  const failed = new Set(['UNDETERMINED', 'CANCELED']);
  while (Date.now() - start < timeoutMs) {
    let tx;
    try {
      tx = await client.getTransaction({ hash });
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    const status = tx?.statusName ?? String(tx?.status ?? '');
    if (done.has(status)) return tx;
    if (failed.has(status)) throw new Error(`Post could not reach consensus (${status})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for validator consensus (try Refresh in a moment)');
}
