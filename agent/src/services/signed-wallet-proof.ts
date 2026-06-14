import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";

export const signedWalletProofFields = {
  message: z.string().trim().min(1).max(1_000),
  signature: z.string().trim().min(1).max(500)
};

export interface SignedWalletProofInput {
  walletAddress: string;
  message: string;
  signature: string;
}

export function validateSignedWalletProof(
  input: SignedWalletProofInput,
  context: z.RefinementCtx,
  action: string
) {
  let recoveredAddress: string;

  try {
    recoveredAddress = verifyMessage(input.message, input.signature);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Signature must be a valid signed-message proof",
      path: ["signature"]
    });
    return;
  }

  if (getAddress(recoveredAddress) !== getAddress(input.walletAddress)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Signature must recover the submitted wallet address",
      path: ["signature"]
    });
  }

  const normalizedMessage = input.message.toLowerCase();
  if (!normalizedMessage.includes(input.walletAddress.toLowerCase())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Signed message must include the submitted wallet address",
      path: ["message"]
    });
  }

  if (!normalizedMessage.includes(action.toLowerCase())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Signed message must include the ${action} action`,
      path: ["message"]
    });
  }
}
