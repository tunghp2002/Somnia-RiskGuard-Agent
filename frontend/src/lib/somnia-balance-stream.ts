import {
  formatUnits,
  type AccountAssetSnapshot,
  type NativeAssetBalance,
  type TokenAssetBalance,
} from "@/lib/blockscout-api";

import type { PublicChainMetadata } from "@/lib/agent-api";

type AccountInput = { address: string; label: string };
type Unsubscribe = () => void;

const assetLogThrottleMs = 60_000;
const balancePollIntervalMs = 30_000;
let lastAssetLogAt = 0;

const erc20BalanceAbi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function logAssetBalanceIssue(message: string, details?: unknown) {
  const now = Date.now();

  if (now - lastAssetLogAt < assetLogThrottleMs) {
    return;
  }

  lastAssetLogAt = now;
  console.warn(`[RiskGuard] ${message}`, details);
}

function createSomniaViemChain(publicChain: PublicChainMetadata) {
  return {
    id: publicChain.chainId,
    name: publicChain.name,
    nativeCurrency: publicChain.nativeCurrency,
    rpcUrls: {
      default: { http: [publicChain.rpcUrl] },
      public: { http: [publicChain.rpcUrl] },
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
    chain: createSomniaViemChain(publicChain),
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
  let stopped = false;
  let pollRefreshInFlight = false;

  const pollBalances = () => {
    if (pollRefreshInFlight || stopped) {
      return;
    }

    const snapshot = getSnapshot();

    if (!snapshot) {
      return;
    }

    pollRefreshInFlight = true;
    void refreshSnapshotBalances({ accounts, currentSnapshot: snapshot, publicChain })
      .then((nextSnapshot) => {
        if (!stopped) {
          onSnapshot(nextSnapshot);
        }
      })
      .catch((error) => {
        logAssetBalanceIssue("Somnia balance poll refresh failed.", error);
      })
      .finally(() => {
        pollRefreshInFlight = false;
      });
  };

  const firstPollTimeoutId = window.setTimeout(pollBalances, 1_000);
  const pollIntervalId = window.setInterval(pollBalances, balancePollIntervalMs);

  return () => {
    stopped = true;
    window.clearTimeout(firstPollTimeoutId);
    window.clearInterval(pollIntervalId);
  };
}
