import {
  ScanLine,
  Send,
  Shield,
  UserRound,
  Wallet
} from "lucide-react";

import type { DashboardSection } from "@/types/dashboard";
import type { ReactNode } from "react";

export const navItems: Array<{ id: DashboardSection; label: string; icon: ReactNode; primaryMobile?: boolean }> = [
  { id: "overview", label: "Overview", icon: <Shield size={17} />, primaryMobile: true },
  { id: "transfer", label: "Transfer", icon: <Send size={17} />, primaryMobile: true },
  { id: "allowances", label: "Allowances", icon: <ScanLine size={17} />, primaryMobile: true },
  { id: "inheritance", label: "Inheritance", icon: <Wallet size={17} />, primaryMobile: true },
  { id: "profile", label: "Profile", icon: <UserRound size={17} />, primaryMobile: true }
];
