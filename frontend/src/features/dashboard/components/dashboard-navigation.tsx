import { Loader2, LogOut, RefreshCw, Shield, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicChainMetadata } from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";
import { navItems } from "../config";
import type { DashboardSection } from "../types";
import { formatAddress } from "../utils";

type NavigationProps = {
  activeSection: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
};

export function DashboardSidebar({
  activeSection,
  onSectionChange,
  publicChain
}: NavigationProps & {
  publicChain: PublicChainMetadata | null;
}) {
  return (
    <aside className="rg-sidebar" aria-label="Primary sections">
      <div className="sidebar-brand"><Shield size={18} /> RiskGuard</div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Button
            aria-current={activeSection === item.id ? "page" : undefined}
            className={activeSection === item.id ? "sidebar-nav-button active" : "sidebar-nav-button"}
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            type="button"
            variant="ghost"
          >
            {item.icon}
            <span>{item.label}</span>
          </Button>
        ))}
      </nav>
      <div className="sidebar-meta">
        <span>{publicChain?.name ?? "Public chain loading"}</span>
        <Badge>Somnia Testnet</Badge>
      </div>
    </aside>
  );
}

export function DashboardHeader({
  actionLoading,
  activeSection,
  onConnectWallet,
  onDisconnectWallet,
  wallet
}: {
  actionLoading: string | null;
  activeSection: DashboardSection;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  wallet: BrowserWalletState | null;
}) {
  const activeNavItem = navItems.find((item) => item.id === activeSection);

  return (
    <header className="rg-header">
      <div>
        <div className="rg-kicker"><Shield size={14} /> Somnia RiskGuard AgentCore</div>
        <h1>{activeNavItem?.label ?? "Overview"}</h1>
      </div>
      <div className="rg-header-actions">
        {wallet ? (
          <div className="wallet-session-actions">
            <Button className="wallet-address-button" type="button" variant="secondary">
              {formatAddress(wallet.address)}
            </Button>
            <Button
              aria-label="Disconnect wallet"
              className="wallet-logout-button"
              disabled={actionLoading === "wallet"}
              onClick={onDisconnectWallet}
              type="button"
              variant="secondary"
            >
              {actionLoading === "wallet" ? <Loader2 className="spin" size={16} /> : <LogOut size={16} />}
            </Button>
          </div>
        ) : (
          <Button
            className="primary-button"
            disabled={actionLoading === "wallet"}
            onClick={onConnectWallet}
            type="button"
            variant="primary"
          >
            {actionLoading === "wallet" ? <Loader2 className="spin" size={16} /> : <Wallet size={16} />}
            Connect Wallet
          </Button>
        )}
      </div>
    </header>
  );
}

export function MobileDashboardNav({
  activeSection,
  mobileMoreOpen,
  onMobileMoreChange,
  onSectionChange
}: NavigationProps & {
  mobileMoreOpen: boolean;
  onMobileMoreChange: (open: boolean) => void;
}) {
  return (
    <>
      <section className="mobile-bottom-nav" aria-label="Mobile sections">
        {navItems.map((item) => (
          <Button
            className={activeSection === item.id ? "active" : ""}
            key={item.id}
            onClick={() => {
              onSectionChange(item.id);
              onMobileMoreChange(false);
            }}
            type="button"
            variant="ghost"
          >
            {item.icon}
            <span>{item.label}</span>
          </Button>
        ))}
      </section>

      {mobileMoreOpen ? (
        <section className="mobile-more-sheet" aria-label="More sections">
          {null}
        </section>
      ) : null}
    </>
  );
}

export function FloatingRefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Button className="floating-refresh" onClick={onRefresh} type="button" variant="secondary">
      <RefreshCw size={16} /> Refresh
    </Button>
  );
}
