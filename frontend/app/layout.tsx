import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../src/app/globals.css";

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
    <html lang="en">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster closeButton duration={10000} position="top-center" richColors />
      </body>
    </html>
  );
}
