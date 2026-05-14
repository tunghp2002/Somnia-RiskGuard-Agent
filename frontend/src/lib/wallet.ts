export interface InjectedEthereumProvider {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[];
  }): Promise<T>;
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
