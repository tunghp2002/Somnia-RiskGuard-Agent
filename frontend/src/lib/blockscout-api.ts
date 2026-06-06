export type BlockscoutAccountScope = "all" | "eoa" | "smart";

export interface AccountOption {
  id: BlockscoutAccountScope;
  label: string;
  address?: string;
}

export interface NativeAssetBalance {
  accountLabel: string;
  address: string;
  balance: string;
  symbol: string;
}

export interface TokenAssetBalance {
  accountLabel: string;
  address: string;
  balance: string;
  decimals: number;
  iconUrl?: string;
  name: string;
  symbol: string;
  tokenAddress: string;
  type: string;
}

export interface NftAssetBalance {
  accountLabel: string;
  address: string;
  collectionAddress: string;
  collectionName: string;
  id: string;
  imageUrl?: string;
  name: string;
}

export interface AccountAssetSnapshot {
  native: NativeAssetBalance[];
  tokens: TokenAssetBalance[];
  nfts: NftAssetBalance[];
}

interface BlockscoutAddressInfo {
  coin_balance?: string | null;
}

interface BlockscoutTokenInfo {
  address_hash?: string;
  decimals?: string | number | null;
  icon_url?: string | null;
  name?: string | null;
  symbol?: string | null;
  type?: string | null;
}

interface BlockscoutTokenBalance {
  token?: BlockscoutTokenInfo | null;
  token_id?: string | null;
  value?: string | null;
}

interface BlockscoutNftItem {
  id?: string | number | null;
  image_url?: string | null;
  metadata?: {
    image?: string;
    image_url?: string;
    name?: string;
  } | null;
  token?: BlockscoutTokenInfo | null;
  token_contract_address_hash?: string | null;
  token_id?: string | null;
  token_instance?: {
    id?: string | number | null;
    image_url?: string | null;
    metadata?: {
      image?: string;
      image_url?: string;
      name?: string;
    } | null;
  } | null;
}

interface BlockscoutList<T> {
  items?: T[];
  next_page_params?: Record<string, string | number | boolean | null> | null;
}

const somniaLogoUrl = "/somnia-logo.png";

export { somniaLogoUrl };

function apiBase(blockscoutUrl: string) {
  return `${blockscoutUrl.replace(/\/$/, "")}/api/v2`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Blockscout request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function withQueryParams(url: string, params?: Record<string, string | number | boolean | null> | null) {
  if (!params) {
    return url;
  }

  const nextUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      nextUrl.searchParams.set(key, String(value));
    }
  });

  return nextUrl.toString();
}

async function fetchBlockscoutList<T>(url: string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const payload: BlockscoutList<T> = await fetchJson<BlockscoutList<T>>(nextUrl);
    items.push(...(payload.items ?? []));
    nextUrl = payload.next_page_params ? withQueryParams(url, payload.next_page_params) : undefined;
  }

  return items;
}

function normalizeIpfsUrl(url?: string | null) {
  if (!url) {
    return undefined;
  }

  return url.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}`
    : url;
}

function formatUnits(value: string, decimals: number) {
  const raw = value.replace(/^0+/, "") || "0";

  if (decimals <= 0) {
    return raw;
  }

  const padded = raw.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  const shortFraction = fraction.slice(0, 6);

  return shortFraction ? `${integer}.${shortFraction}` : integer;
}

export async function fetchAccountAssets({
  accounts,
  blockscoutUrl,
  nativeDecimals,
  nativeSymbol,
}: {
  accounts: Array<{ label: string; address: string }>;
  blockscoutUrl: string;
  nativeDecimals: number;
  nativeSymbol: string;
}): Promise<AccountAssetSnapshot> {
  const baseUrl = apiBase(blockscoutUrl);
  const snapshots = await Promise.all(
    accounts.map(async (account) => {
      const encodedAddress = encodeURIComponent(account.address);
      const [addressInfo, tokenItems, nftItems] = await Promise.all([
        fetchJson<BlockscoutAddressInfo>(`${baseUrl}/addresses/${encodedAddress}`),
        fetchJson<BlockscoutTokenBalance[]>(`${baseUrl}/addresses/${encodedAddress}/token-balances`),
        fetchBlockscoutList<BlockscoutNftItem>(`${baseUrl}/addresses/${encodedAddress}/nft`).catch(() => []),
      ]);

      return {
        native: {
          accountLabel: account.label,
          address: account.address,
          balance: formatUnits(addressInfo.coin_balance ?? "0", nativeDecimals),
          symbol: nativeSymbol,
        },
        tokens: tokenItems
          .filter((item) => item.token?.type !== "ERC-721" && item.token?.type !== "ERC-1155")
          .map((item) => {
            const decimals = Number(item.token?.decimals ?? 18);
            const iconUrl = normalizeIpfsUrl(item.token?.icon_url);
            const token = {
              accountLabel: account.label,
              address: account.address,
              balance: formatUnits(item.value ?? "0", Number.isFinite(decimals) ? decimals : 18),
              decimals: Number.isFinite(decimals) ? decimals : 18,
              name: item.token?.name ?? "Unknown token",
              symbol: item.token?.symbol ?? "TOKEN",
              tokenAddress: item.token?.address_hash ?? "",
              type: item.token?.type ?? "ERC-20",
            };

            return iconUrl ? { ...token, iconUrl } : token;
          }),
        nfts: nftItems.map((item) => {
          const instance = item.token_instance;
          const metadata = instance?.metadata ?? item.metadata ?? {};

          const imageUrl = normalizeIpfsUrl(instance?.image_url ?? item.image_url ?? metadata.image_url ?? metadata.image);

          return {
            accountLabel: account.label,
            address: account.address,
            collectionAddress: item.token?.address_hash ?? item.token_contract_address_hash ?? "",
            collectionName: item.token?.name ?? "NFT Collection",
            id: String(instance?.id ?? item.id ?? item.token_id ?? "unknown"),
            name: metadata.name ?? item.token?.name ?? "NFT",
            ...(imageUrl ? { imageUrl } : {}),
          };
        }),
      };
    }),
  );

  return {
    native: snapshots.map((snapshot) => snapshot.native),
    tokens: snapshots.flatMap((snapshot) => snapshot.tokens),
    nfts: snapshots.flatMap((snapshot) => snapshot.nfts),
  };
}
