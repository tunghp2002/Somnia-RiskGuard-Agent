import { describe, expect, it } from "vitest";

import {
  formatCheckInError,
  isPaymasterServerError,
} from "./telegram-check-in.service.js";

describe("formatCheckInError", () => {
  it("explains registry NoActivePlan selector errors", () => {
    const message = [
      'Encoded error signature "0xa562fe00" not found on ABI.',
      "Make sure you are using the correct ABI and that the error exists on it.",
    ].join("\n");

    expect(formatCheckInError(new Error(message))).toBe(
      "No active inheritance plan is configured for this smart account. Open RiskGuard settings, select this smart account, and create or approve a heartbeat plan before using /checkin.",
    );
  });

  it("explains NoActivePlan as a sender mismatch when the linked account has a plan", () => {
    const message = 'Encoded error signature "0xa562fe00" not found on ABI.';

    expect(
      formatCheckInError(new Error(message), {
        linkedSmartAccountHasActivePlan: true,
      }),
    ).toBe(
      "The linked smart account has an active plan, but the check-in transaction reached the registry from a different sender. Re-authorize Telegram check-in for this smart account, then retry /checkin.",
    );
  });

  it("keeps the thirdweb secret key guidance for unauthorized backend keys", () => {
    expect(
      formatCheckInError(
        new Error("thirdweb_getUserOperationGasPrice failed. Status: 401"),
      ),
    ).toContain("Backend THIRDWEB_SECRET_KEY is invalid");
  });
});

describe("isPaymasterServerError", () => {
  it("detects paymaster 500 errors for user-paid retry", () => {
    expect(
      isPaymasterServerError(
        new Error(
          'Paymaster error: 500 - {"error":"Internal server error","code":500}',
        ),
      ),
    ).toBe(true);
  });

  it("does not treat unrelated errors as paymaster server failures", () => {
    expect(isPaymasterServerError(new Error("NoActivePlan()"))).toBe(false);
  });
});
