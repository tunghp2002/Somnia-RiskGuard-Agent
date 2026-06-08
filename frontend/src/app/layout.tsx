import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "SomGuard",
  description: "AI portfolio guardian for Somnia."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (

    // suppressHydrationWarning: browser extensions inject inline styles/attributes
    // (e.g. --color-tl-* CSS vars) onto <html>/<body> before React hydrates. Those
    // aren't produced by our render, so silence the one-level attribute mismatch.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster closeButton duration={10000} position="top-center" richColors />
      </body>
    </html>
  );
}
