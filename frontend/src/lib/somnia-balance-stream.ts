import {
  formatUnits,
  type AccountAssetSnapshot,
  type NativeAssetBalance,
  type TokenAssetBalance,
} from "@/lib/blockscout-api";

import type { PublicChainMetadata } from "@/lib/agent-api";

type AccountInput = { address: string; label: string };
type Unsubscribe = () => void;
type SomniaStreamSubscription = {
  unsubscribe: () => Promise<unknown>;
};
type SomniaStreamSubscriber = {
  subscribe: (params: {
    ethCalls: [];
    onData: (data: unknown) => void;
    onError?: (error: Error) => void;
  }) => Promise<Error | SomniaStreamSubscription>;
};

const streamLogThrottleMs = 60_000;
let lastStreamLogAt = 0;

const erc20BalanceAbi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function rpcWebSocketUrl(publicChain: PublicChainMetadata) {
  const configured = process.env.NEXT_PUBLIC_SOMNIA_STREAM_WS_URL;

  if (configured) {
    return configured;
  }

  if (publicChain.chainId === 50312) {
    return "wss://api.infra.testnet.somnia.network/ws";
  }

  return publicChain.rpcUrl.replace(/^http/i, "ws");
}

function logSomniaBalanceStreamIssue(message: string, details?: unknown) {
  const now = Date.now();

  if (now - lastStreamLogAt < streamLogThrottleMs) {
    return;
  }

  lastStreamLogAt = now;
  console.warn(`[RiskGuard] ${message}`, details);
}

function createSomniaViemChain(publicChain: PublicChainMetadata, wsUrl: string) {
  return {
    id: publicChain.chainId,
    name: publicChain.name,
    nativeCurrency: publicChain.nativeCurrency,
    rpcUrls: {
      default: { http: [publicChain.rpcUrl], webSocket: [wsUrl] },
      public: { http: [publicChain.rpcUrl], webSocket: [wsUrl] },
    },
  } as const;
}

function tokenKey(token: TokenAssetBalance) {
  return `${token.address.toLowerCase()}:${token.tokenAddress.toLowerCase()}`;
}

async function refreshSnapshotBalances({
  accounts,
  currentSnapshot,
  publicChain,
}: {
  accounts: AccountInput[];
  currentSnapshot: AccountAssetSnapshot;
  publicChain: PublicChainMetadata;
}) {
  const [{ createPublicClient, http }, { getAddress }] = await Promise.all([
    import("viem"),
    import("viem"),
  ]);
  const client = createPublicClient({
    chain: createSomniaViemChain(publicChain, rpcWebSocketUrl(publicChain)),
    transport: http(publicChain.rpcUrl),
  });
  const accountByAddress = new Map(accounts.map((account) => [account.address.toLowerCase(), account]));
  const native = await Promise.all(
    accounts.map(async (account): Promise<NativeAssetBalance> => ({
      accountLabel: account.label,
      address: account.address,
      balance: formatUnits((await client.getBalance({ address: getAddress(account.address) })).toString(), publicChain.nativeCurrency.decimals),
      symbol: publicChain.nativeCurrency.symbol,
    })),
  );
  const tokenEntries = await Promise.all(
    currentSnapshot.tokens.map(async (token) => {
      const account = accountByAddress.get(token.address.toLowerCase());

      if (!account || !token.tokenAddress) {
        return [tokenKey(token), token] as const;
      }

      try {
        const balance = await client.readContract({
          abi: erc20BalanceAbi,
          address: getAddress(token.tokenAddress),
          args: [getAddress(account.address)],
          functionName: "balanceOf",
        });

        return [
          tokenKey(token),
          {
            ...token,
            balance: formatUnits(balance.toString(), token.decimals),
          },
        ] as const;
      } catch {
        return [tokenKey(token), token] as const;
      }
    }),
  );
  const tokenByKey = new Map(tokenEntries);

  return {
    native,
    tokens: currentSnapshot.tokens.map((token) => tokenByKey.get(tokenKey(token)) ?? token),
    nfts: currentSnapshot.nfts,
  };
}

export async function subscribeSomniaBalanceStream({
  accounts,
  getSnapshot,
  onSnapshot,
  publicChain,
}: {
  accounts: AccountInput[];
  getSnapshot: () => AccountAssetSnapshot | null;
  onSnapshot: (snapshot: AccountAssetSnapshot) => void;
  publicChain: PublicChainMetadata;
}): Promise<Unsubscribe> {
  const wsUrl = rpcWebSocketUrl(publicChain);
  const [{ SDK }, { createPublicClient, webSocket }] = await Promise.all([
    import("@somnia-chain/streams"),
    import("viem"),
  ]);
  const streamClient = createPublicClient({
    chain: createSomniaViemChain(publicChain, wsUrl),
    transport: webSocket(wsUrl),
  });
  const sdk = new SDK({ public: streamClient });
  let stopped = false;
  let refreshTimer: number | undefined;

  const refreshBalances = () => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(() => {
      const snapshot = getSnapshot();

      if (!snapshot || stopped) {
        return;
      }

      void refreshSnapshotBalances({ accounts, currentSnapshot: snapshot, publicChain })
        .then((nextSnapshot) => {
          if (!stopped) {
            onSnapshot(nextSnapshot);
          }
        })
        .catch((error) => {
          logSomniaBalanceStreamIssue("Somnia balance stream refresh failed.", error);
        });
    }, 1_000);
  };

  const streamSubscriber = sdk.streams as unknown as Partial<SomniaStreamSubscriber>;

  if (!streamSubscriber.subscribe) {
    throw new Error("Somnia Streams SDK subscription support is unavailable. Install @somnia-chain/streams >= 0.12.");
  }

  const subscription = await streamSubscriber.subscribe({
    ethCalls: [],
    onData: refreshBalances,
    onError: (error) => {
      logSomniaBalanceStreamIssue("Somnia balance stream event callback failed.", error);
    },
  });

  if (subscription instanceof Error) {
    logSomniaBalanceStreamIssue(
      "Somnia balance stream is unavailable; cached Blockscout data will remain in use.",
      { chainId: publicChain.chainId, wsUrl, error: subscription.message },
    );
    throw subscription;
  }

  refreshBalances();

  return () => {
    stopped = true;

    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }

    void subscription.unsubscribe();
  };
}
