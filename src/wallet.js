// Browser wallet (MetaMask / EIP-1193) integration for the AI Tribunal.
//
// GenLayer's chain is an EVM L2, so any injected EIP-1193 provider
// (window.ethereum) can sign transactions. We expose helpers to detect,
// connect, and add/switch to the target GenLayer network.

import { testnetBradbury, testnetAsimov, studionet, localnet } from 'genlayer-js/chains';

const CHAINS = {
  'testnet-bradbury': testnetBradbury,
  'testnet-asimov': testnetAsimov,
  studionet,
  localnet,
};

const NETWORK = import.meta.env.VITE_GENLAYER_NETWORK ?? 'testnet-bradbury';

export function getProvider() {
  return typeof window !== 'undefined' ? window.ethereum ?? null : null;
}

export function hasWallet() {
  return !!getProvider();
}

function toHexChainId(id) {
  return '0x' + Number(id).toString(16);
}

// Resolve the target chain's id + RPC for wallet_addEthereumChain.
function targetChainParams() {
  const chain = CHAINS[NETWORK] ?? testnetBradbury;
  const id = chain?.id ?? 4221;
  const rpc =
    import.meta.env.VITE_GENLAYER_RPC_URL ||
    chain?.rpcUrls?.default?.http?.[0] ||
    'https://rpc-bradbury.genlayer.com';
  return {
    chainId: toHexChainId(id),
    chainName: chain?.name ?? 'GenLayer',
    nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
    rpcUrls: [rpc],
  };
}

// Ask the wallet to switch to the GenLayer chain, adding it if unknown.
async function ensureChain(provider) {
  const params = targetChainParams();
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: params.chainId }],
    });
  } catch (err) {
    // 4902 = chain not added yet → add it, then it becomes active.
    if (err?.code === 4902 || /Unrecognized chain/i.test(String(err?.message))) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
    } else if (err?.code !== 4001) {
      // Ignore non-fatal errors; some wallets manage chains automatically.
    }
  }
}

// Connect the wallet and return { address, provider }.
export async function connectWallet() {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No wallet found. Install MetaMask to take the bench.');
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No account authorized.');
  }
  await ensureChain(provider);
  return { address: accounts[0], provider };
}

// Subscribe to account changes; returns an unsubscribe fn.
export function onAccountsChanged(cb) {
  const provider = getProvider();
  if (!provider?.on) return () => {};
  const handler = (accounts) => cb(accounts?.[0] ?? null);
  provider.on('accountsChanged', handler);
  return () => provider.removeListener?.('accountsChanged', handler);
}
