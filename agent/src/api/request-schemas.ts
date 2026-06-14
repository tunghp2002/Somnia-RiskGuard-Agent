import { getAddress } from "ethers";
import { z } from "zod";

import { sessionKeyActionSchema } from "../services/session-key-actions.js";
import {
  signedWalletProofFields,
  validateSignedWalletProof
} from "../services/signed-wallet-proof.js";

export const sessionKeyActionRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value))
      .optional(),
    action: sessionKeyActionSchema.default("checkin"),
    ...signedWalletProofFields
  })
  .strict()
  .superRefine((input, context) =>
    validateSignedWalletProof(input, context, `session-key.${input.action}`)
  );
