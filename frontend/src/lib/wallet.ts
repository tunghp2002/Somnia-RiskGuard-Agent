export interface InjectedEthereumProvider {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[];
  }): Promise<T>;
  on?(event: "accountsChanged" | "chainChanged", handler: (...args: unknown[]) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", handler: (...args: unknown[]) => void): void;
}

export interface BrowserWalletState {
  address: string;
  chainId: string;
}

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider;
  }
}

function getProvider(): InjectedEthereumProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet detected");
  }

  return window.ethereum;
}

export async function connectBrowserWallet(): Promise<BrowserWalletState> {
  const provider = getProvider();
  const accounts = await provider.request<string[]>({
    method: "eth_requestAccounts"
  });
  const address = accounts[0];

  if (!address) {
    throw new Error("Wallet connection returned no account");
  }

  const chainId = await provider.request<string>({
    method: "eth_chainId"
  });

  return { address, chainId };
}

export async function restoreBrowserWallet(): Promise<BrowserWalletState | null> {
  if (typeof window === "undefined" || !window.ethereum) {
    return null;
  }

  const accounts = await window.ethereum.request<string[]>({
    method: "eth_accounts"
  });
  const address = accounts[0];

  if (!address) {
    return null;
  }

  const chainId = await window.ethereum.request<string>({
    method: "eth_chainId"
  });

  return { address, chainId };
}

export async function signWalletMessage(message: string): Promise<string> {
  const provider = getProvider();
  const accounts = await provider.request<string[]>({
    method: "eth_accounts"
  });
  const address = accounts[0];

  if (!address) {
    throw new Error("Connect a browser wallet before signing");
  }

  return provider.request<string>({
    method: "personal_sign",
    params: [message, address]
  });
}

export async function disconnectBrowserWallet(): Promise<void> {
  const provider = getProvider();

  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }]
    });
  } catch {
    // Some wallets do not expose programmatic disconnect; the UI still clears local state.
  }
}

export interface BrowserTransactionRequest {
  to: string;
  data?: string;
  value?: string; // hex-quantity (e.g. "0x...") or decimal string
}

export interface BrowserTransactionReceipt {
  transactionHash: string;
  status: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
}

export interface BrowserChainConfig {
  blockExplorerUrls?: string[];
  chainId: string;
  chainName: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: string[];
}

function toHexQuantity(value: string): string {
  if (value.startsWith("0x")) {
    return value;
  }
  return `0x${BigInt(value).toString(16)}`;
}

export async function ensureBrowserChain(
  chainIdHex: string,
  chainConfig?: BrowserChainConfig
): Promise<void> {
  const provider = getProvider();
  const current = await provider.request<string>({ method: "eth_chainId" });
  if (chainConfig) {
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [chainConfig]
      });
    } catch {
      // Wallets may reject updates for an already-known chain. Switching below
      // will still work if the existing RPC is healthy.
    }
  }

  if (current?.toLowerCase() === chainIdHex.toLowerCase()) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }]
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;

    if ((code !== 4902 && code !== -32006) || !chainConfig) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [chainConfig]
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }]
    });
  }
}

export async function sendBrowserTransaction(
  request: BrowserTransactionRequest
): Promise<string> {
  const provider = getProvider();
  const accounts = await provider.request<string[]>({ method: "eth_accounts" });
  const from = accounts[0];
  if (!from) {
    throw new Error("Connect a browser wallet before sending a transaction");
  }

  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: request.to,
        ...(request.data ? { data: request.data } : {}),
        ...(request.value ? { value: toHexQuantity(request.value) } : {})
      }
    ]
  });
}

export async function waitForBrowserReceipt(
  txHash: string,
  { timeoutMs = 120_000, intervalMs = 3_000 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<BrowserTransactionReceipt> {
  const provider = getProvider();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const receipt = await provider.request<BrowserTransactionReceipt | null>({
      method: "eth_getTransactionReceipt",
      params: [txHash]
    });
    if (receipt) {
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for the transaction receipt");
}

export function subscribeBrowserWalletChanges(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.ethereum?.on) {
    return () => {};
  }

  const handleAccountsChanged = () => onChange();
  const handleChainChanged = () => onChange();

  window.ethereum.on("accountsChanged", handleAccountsChanged);
  window.ethereum.on("chainChanged", handleChainChanged);

  return () => {
    window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
    window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
  };
}
