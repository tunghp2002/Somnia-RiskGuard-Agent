import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Field } from "./inheritance-settings-controls";
import { clampNumber } from "@/utils";

import type { TokenDraft } from "@/types";
import type { Dispatch, RefObject, SetStateAction } from "react";

export function TokenImportDialog({
  addToken,
  open,
  setOpen,
  setTokenDraft,
  setTokenSubmitted,
  tokenAddressError,
  tokenAddressRef,
  tokenDecimalsError,
  tokenDecimalsRef,
  tokenDraft,
  tokenSubmitted,
  tokenSymbolError,
  tokenSymbolRef,
}: {
  addToken: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  setTokenDraft: Dispatch<SetStateAction<TokenDraft>>;
  setTokenSubmitted: (submitted: boolean) => void;
  tokenAddressError: string;
  tokenAddressRef: RefObject<HTMLInputElement | null>;
  tokenDecimalsError: string;
  tokenDecimalsRef: RefObject<HTMLInputElement | null>;
  tokenDraft: TokenDraft;
  tokenSubmitted: boolean;
  tokenSymbolError: string;
  tokenSymbolRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setTokenSubmitted(false);
      }
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="token-dialog-overlay" />
        <DialogPrimitive.Content className="token-dialog-content">
          <DialogPrimitive.Title>Import token</DialogPrimitive.Title>
          <DialogPrimitive.Description className="token-dialog-description">
            Add an ERC-20 asset that the smart account should distribute with this plan.
          </DialogPrimitive.Description>
          <Field
            error={tokenSubmitted ? tokenAddressError || undefined : undefined}
            id="token-contract-address"
            label="Token contract address"
          >
            <Input
              id="token-contract-address"
              onChange={(event) => setTokenDraft((current) => ({ ...current, address: event.target.value }))}
              ref={tokenAddressRef}
              value={tokenDraft.address}
            />
          </Field>
          <Field
            error={tokenSubmitted ? tokenSymbolError || undefined : undefined}
            id="token-symbol"
            label="Token symbol"
          >
            <Input
              id="token-symbol"
              maxLength={11}
              onChange={(event) => setTokenDraft((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
              ref={tokenSymbolRef}
              value={tokenDraft.symbol}
            />
          </Field>
          <Field
            error={tokenSubmitted ? tokenDecimalsError || undefined : undefined}
            id="token-decimals"
            label="Token decimal"
          >
            <Input
              id="token-decimals"
              inputMode="numeric"
              onChange={(event) => setTokenDraft((current) => ({ ...current, decimals: clampNumber(event.target.value, 0, 255) }))}
              ref={tokenDecimalsRef}
              value={tokenDraft.decimals}
            />
          </Field>
          <div className="token-dialog-actions">
            <Button onClick={() => setOpen(false)} type="button" variant="secondary">Cancel</Button>
            <Button onClick={addToken} type="button" variant="primary">Add token</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
