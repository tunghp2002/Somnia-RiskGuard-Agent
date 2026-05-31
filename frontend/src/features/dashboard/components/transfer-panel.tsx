import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Send } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { formatAddress } from "../utils";

import type {
  NativeTransferEstimate,
  NativeTransferInput,
  TransferSource
} from "../types";
import type { PublicChainMetadata } from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";

const emptyEstimateState = {
  error: null as string | null,
  loading: false,
  value: null as NativeTransferEstimate | null
};

export function TransferPanel({
  actionLoading,
  estimateTransfer,
  onConnectWallet,
  onTransferSubmit,
  publicChain,
  smartAccountAddress,
  wallet
}: {
  actionLoading: string | null;
  estimateTransfer: (input: NativeTransferInput) => Promise<NativeTransferEstimate>;
  onConnectWallet: () => Promise<void>;
  onTransferSubmit: (input: NativeTransferInput) => Promise<boolean>;
  publicChain: PublicChainMetadata | null;
  smartAccountAddress: string | undefined;
  wallet: BrowserWalletState | null;
}) {
  const [source, setSource] = useState<TransferSource>("smart");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [estimate, setEstimate] = useState(emptyEstimateState);

  const sourceAddress = source === "eoa" ? wallet?.address : smartAccountAddress;
  const canShowEstimate = touched || Boolean(recipient.trim() || amount.trim());
  const submitDisabled =
    actionLoading === "transfer" ||
    estimate.loading ||
    !estimate.value ||
    Boolean(estimate.error);
  const input = useMemo(
    () => ({
      amount,
      recipient,
      source
    }),
    [amount, recipient, source]
  );

  useEffect(() => {
    if (!recipient.trim() || !amount.trim()) {
      setEstimate(emptyEstimateState);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setEstimate({ error: null, loading: true, value: null });
      estimateTransfer(input)
        .then((value) => setEstimate({ error: null, loading: false, value }))
        .catch((error: unknown) => {
          setEstimate({
            error: error instanceof Error ? error.message : "Could not estimate transfer fee.",
            loading: false,
            value: null
          });
        });
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [estimateTransfer, input]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    const ok = await onTransferSubmit(input);
    if (ok) {
      setRecipient("");
      setAmount("");
      setEstimate(emptyEstimateState);
    }
  }

  return (
    <section className="transfer-screen">
      <section className="transfer-panel panel">
        <div className="panel-heading">
          <div>
            <h2>Transfer</h2>
            <span>{publicChain?.nativeCurrency.symbol ?? "STT"} native token</span>
          </div>
        </div>

        <form className="transfer-form" onSubmit={handleSubmit}>
          <label>
            Send from
            <div className="transfer-select-wrap">
              <select
                aria-label="Transfer source"
                onChange={(event) => {
                  setSource(event.target.value as TransferSource);
                  setTouched(false);
                  setEstimate(emptyEstimateState);
                }}
                value={source}
              >
                <option value="smart">Smart account</option>
                <option value="eoa">EOA wallet</option>
              </select>
              <ChevronDown size={16} />
            </div>
            <div className={sourceAddress ? "transfer-address-box" : "transfer-address-box empty"}>
              <span>{source === "smart" ? "Thirdweb smart account" : "Browser wallet"}</span>
              <strong>{sourceAddress ? formatAddress(sourceAddress) : "not connected"}</strong>
            </div>
          </label>

          <label>
            Recipient
            <Input
              aria-invalid={Boolean(touched && estimate.error && estimate.error.toLowerCase().includes("recipient"))}
              autoComplete="off"
              inputMode="text"
              onBlur={() => setTouched(true)}
              onChange={(event) => {
                setRecipient(event.target.value);
                setTouched(true);
              }}
              placeholder="0x..."
              spellCheck={false}
              value={recipient}
            />
          </label>

          <label>
            Amount
            <div className="transfer-amount-input">
              <Input
                aria-invalid={Boolean(touched && estimate.error && estimate.error.toLowerCase().includes("amount"))}
                inputMode="decimal"
                min="0"
                onBlur={() => setTouched(true)}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setTouched(true);
                }}
                placeholder="0.00"
                step="any"
                type="number"
                value={amount}
              />
              <span>{publicChain?.nativeCurrency.symbol ?? "STT"}</span>
            </div>
          </label>

          {canShowEstimate ? <div className="transfer-estimate-box">
            {estimate.loading ? (
              <span className="transfer-estimate-row">
                <Loader2 className="spin" size={15} />
                Estimating network fee
              </span>
            ) : estimate.error && touched ? (
              <span className="transfer-estimate-row bad">
                <AlertCircle size={15} />
                {estimate.error}
              </span>
            ) : estimate.value ? (
              <>
                <span className="transfer-estimate-row">
                  <CheckCircle2 size={15} />
                  Estimated fee
                  <strong>{estimate.value.gasLabel}</strong>
                </span>
                <span className="transfer-estimate-row muted-row">
                  Total debit
                  <strong>{estimate.value.totalLabel}</strong>
                </span>
              </>
            ) : (
              <span className="transfer-estimate-row muted-row">Enter recipient and amount to estimate fee.</span>
            )}
          </div> : null}

          <div className="transfer-actions">
            {!wallet ? (
              <Button disabled={actionLoading === "wallet"} onClick={onConnectWallet} type="button" variant="secondary">
                {actionLoading === "wallet" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                Connect wallet
              </Button>
            ) : null}
            <Button className="transfer-send-button" disabled={submitDisabled} type="submit" variant="primary">
              {actionLoading === "transfer" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              Send
            </Button>
          </div>
        </form>
      </section>
    </section>
  );
}
