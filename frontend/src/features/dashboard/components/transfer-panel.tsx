import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Send } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  useNativeTransferEstimate,
  type TransferEstimateState,
} from "../hooks/use-native-transfer-estimate";
import { formatAddress } from "../utils";

import type {
  NativeTransferEstimate,
  NativeTransferInput,
  TransferSource,
} from "../types";
import type { PublicChainMetadata } from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";

export function TransferPanel({
  actionLoading,
  estimateTransfer,
  onConnectWallet,
  onTransferSubmit,
  publicChain,
  smartAccountAddress,
  wallet,
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

  const symbol = publicChain?.nativeCurrency.symbol ?? "STT";
  const sourceAddress = source === "eoa" ? wallet?.address : smartAccountAddress;

  const input = useMemo<NativeTransferInput>(
    () => ({ amount, recipient, source }),
    [amount, recipient, source],
  );
  const estimate = useNativeTransferEstimate(input, estimateTransfer);

  const canShowEstimate = touched || Boolean(recipient.trim() || amount.trim());
  const submitDisabled =
    actionLoading === "transfer" ||
    estimate.loading ||
    !estimate.value ||
    Boolean(estimate.error);

  function resetForm() {
    setRecipient("");
    setAmount("");
    setTouched(false);
  }

  function hasError(keyword: string) {
    return Boolean(touched && estimate.error?.toLowerCase().includes(keyword));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    const ok = await onTransferSubmit(input);
    if (ok) {
      resetForm();
    }
  }

  return (
    <section className="transfer-screen">
      <section className="transfer-panel panel">
        <div className="panel-heading">
          <div>
            <h2>Transfer</h2>
            <span>{symbol} native token</span>
          </div>
        </div>

        <form className="transfer-form" onSubmit={handleSubmit}>
          <TransferSourceField
            source={source}
            sourceAddress={sourceAddress}
            onSourceChange={(nextSource) => {
              setSource(nextSource);
              setTouched(false);
            }}
          />

          <label>
            Recipient
            <Input
              aria-invalid={hasError("recipient")}
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
                aria-invalid={hasError("amount")}
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
              <span>{symbol}</span>
            </div>
          </label>

          {canShowEstimate ? <TransferEstimateBox estimate={estimate} touched={touched} /> : null}

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

function TransferSourceField({
  source,
  sourceAddress,
  onSourceChange,
}: {
  source: TransferSource;
  sourceAddress: string | undefined;
  onSourceChange: (source: TransferSource) => void;
}) {
  return (
    <label>
      Send from
      <div className="transfer-select-wrap">
        <select
          aria-label="Transfer source"
          onChange={(event) => onSourceChange(event.target.value as TransferSource)}
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
  );
}

function TransferEstimateBox({
  estimate,
  touched,
}: {
  estimate: TransferEstimateState;
  touched: boolean;
}) {
  return (
    <div className="transfer-estimate-box">
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
    </div>
  );
}
