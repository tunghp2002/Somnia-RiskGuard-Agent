import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";

export const telegramBindingRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    chatId: z.string().regex(/^-?\d+$/),
    telegramUserId: z.string().regex(/^\d+$/).optional(),
    telegramUsername: z.string().min(1).max(64).optional(),
    telegramDisplayName: z.string().min(1).max(128).optional(),
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value))
      .optional()
  })
  .strict();

const signedProofFieldsSchema = z
  .object({
    signature: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

const signedWalletMutationSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    signature: z.string().min(1),
    message: z.string().min(1)
  })
  .strict()
  .superRefine(validateSignedWalletMutation);

export const telegramSignedBindingRequestSchema = telegramBindingRequestSchema
  .merge(signedProofFieldsSchema)
  .superRefine(validateSignedWalletMutation);

export const telegramUnlinkRequestSchema = signedWalletMutationSchema;

export const riskGuardAgentReviewRequestedSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    guardedTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    requestTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  })
  .strict();

export const telegramCallbackRequestSchema = z
  .object({
    chatId: z.string().regex(/^-?\d+$/),
    messageId: z.string().regex(/^\d+$/).optional(),
    telegramUserId: z.string().regex(/^\d+$/).optional(),
    data: z.string().min(1)
  })
  .strict();

export type TelegramBindingRequest = z.infer<typeof telegramBindingRequestSchema>;
export type TelegramSignedBindingRequest = z.infer<typeof telegramSignedBindingRequestSchema>;
export type TelegramUnlinkRequest = z.infer<typeof telegramUnlinkRequestSchema>;
export type RiskGuardAgentReviewRequested = z.infer<typeof riskGuardAgentReviewRequestedSchema>;
export type TelegramCallbackRequest = z.infer<typeof telegramCallbackRequestSchema>;

function validateSignedWalletMutation(
  input: { walletAddress: string; message: string; signature: string },
  context: z.RefinementCtx
) {
  let recoveredAddress: string;

  try {
    recoveredAddress = verifyMessage(input.message, input.signature);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Signature must be a valid signed-message proof",
      path: ["signature"]
    });
    return;
  }

  if (getAddress(recoveredAddress) !== input.walletAddress) {
    context.addIssue({
      code: "custom",
      message: "Signature must recover the submitted wallet address",
      path: ["signature"]
    });
  }

  if (!input.message.toLowerCase().includes(input.walletAddress.toLowerCase())) {
    context.addIssue({
      code: "custom",
      message: "Signed message must include the submitted wallet address",
      path: ["message"]
    });
  }
}
