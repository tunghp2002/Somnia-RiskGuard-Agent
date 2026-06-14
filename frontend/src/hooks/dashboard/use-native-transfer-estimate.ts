import { useEffect, useState } from "react";

import type {
  NativeTransferEstimate,
  NativeTransferInput,
} from "@/types";

export type TransferEstimateState = {
  error: string | null;
  loading: boolean;
  value: NativeTransferEstimate | null;
};

const emptyEstimateState: TransferEstimateState = {
  error: null,
  loading: false,
  value: null,
};

const debounceMs = 450;

/**
 * Debounced network-fee estimate for a native transfer.
 *
 * The estimate is treated as external async state: every reset/update happens
 * inside a timeout callback (never synchronously in the effect body), which
 * avoids the cascading re-render that `react-hooks/set-state-in-effect` warns
 * about.
 */
export function useNativeTransferEstimate(
  input: NativeTransferInput,
  estimateTransfer: (input: NativeTransferInput) => Promise<NativeTransferEstimate>,
): TransferEstimateState {
  const [estimate, setEstimate] = useState<TransferEstimateState>(emptyEstimateState);
  const hasInput = Boolean(input.recipient.trim() && input.amount.trim());

  useEffect(() => {
    if (!hasInput) {
      const resetId = window.setTimeout(() => setEstimate(emptyEstimateState), 0);
      return () => window.clearTimeout(resetId);
    }

    const timeoutId = window.setTimeout(() => {
      setEstimate({ error: null, loading: true, value: null });
      estimateTransfer(input)
        .then((value) => setEstimate({ error: null, loading: false, value }))
        .catch((error: unknown) => {
          setEstimate({
            error: error instanceof Error ? error.message : "Could not estimate transfer fee.",
            loading: false,
            value: null,
          });
        });
    }, debounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [estimateTransfer, hasInput, input]);

  return estimate;
}

export { emptyEstimateState };
