/**
 * Thin wrapper around a plain `<img>` for remote token/NFT artwork.
 *
 * These sources are arbitrary Blockscout/IPFS URLs, so `next/image`
 * optimisation is not a fit. Centralising the element here keeps the single
 * `no-img-element` suppression in one place instead of scattering it across
 * every asset list and modal.
 */
export function AssetImage({ src, alt = "" }: { src: string; alt?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} src={src} />;
}
