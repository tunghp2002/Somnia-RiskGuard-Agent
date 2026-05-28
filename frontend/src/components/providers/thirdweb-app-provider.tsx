"use client";

import { ThirdwebProvider } from "thirdweb/react";

import type { ReactNode } from "react";

export function ThirdwebAppProvider({ children }: { children: ReactNode }) {
  return <ThirdwebProvider>{children}</ThirdwebProvider>;
}
