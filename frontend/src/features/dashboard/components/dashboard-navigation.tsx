import { Loader2, Menu, RefreshCw, Shield, Wallet, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Mode, PublicChainMetadata } from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";
import { navItems, sectionDescriptions } from "../config";
import type { AccountStatus, DashboardSection } from "../types";
import { formatAddress } from "../utils";

type NavigationProps = {
  activeSection: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
};

export function DashboardSidebar({
  activeSection,
  mode,
  onSectionChange,
  publicChain
}: NavigationProps & {
  mode: Mode;
  publicChain: PublicChainMetadata | null;
}) {
  const navGroups = [
    {
      items: navItems.filter((item) => ["overview", "inheritance", "risk", "receipts"].includes(item.id)),
      label: "Monitor"
    },
    {
      items: navItems.filter((item) => ["demo", "health"].includes(item.id)),
      label: "Operations"
    },
    {
      items: navItems.filter((item) => ["profile"].includes(item.id)),
      label: "Settings"
    }
  ];

  return (
    <aside className="rg-sidebar" aria-label="Primary sections">
      <div className="sidebar-brand"><Shield size={18} /> RiskGuard</div>
      <nav className="sidebar-nav">
        {navGroups.map((group) => (
          <div className="sidebar-nav-group" key={group.label}>
            <span className="sidebar-nav-label">{group.label}</span>
            {group.items.map((item) => (
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
          </div>
        ))}
      </nav>
      <div className="sidebar-meta">
        <span>{publicChain?.name ?? "Public chain loading"}</span>
        <Badge>{mode === "simulation" ? "Simulation" : "Somnia Testnet"}</Badge>
      </div>
    </aside>
  );
}

export function DashboardHeader({
  accountStatus,
  actionLoading,
  activeSection,
  mode,
  onConnectWallet,
  onDisconnectWallet,
  onModeChange,
  wallet
}: {
  accountStatus: AccountStatus;
  actionLoading: string | null;
  activeSection: DashboardSection;
  mode: Mode;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onModeChange: (mode: Mode) => void;
  wallet: BrowserWalletState | null;
}) {
  const activeNavItem = navItems.find((item) => item.id === activeSection);

  return (
    <header className="rg-header">
      <div>
        <div className="rg-kicker"><Shield size={14} /> Somnia RiskGuard AgentCore</div>
        <h1>{activeNavItem?.label ?? "Overview"}</h1>
        <p>{sectionDescriptions[activeSection]}</p>
      </div>
      <div className="rg-header-actions">
        <div className="account-status" aria-label="Account state">
          <span>{accountStatus}</span>
          <strong>{wallet ? formatAddress(wallet.address) : "no browser wallet"}</strong>
        </div>
        <div className="mode-switch" aria-label="Reality mode">
          <Button
            className={mode === "simulation" ? "active" : ""}
            onClick={() => onModeChange("simulation")}
            type="button"
            variant="ghost"
          >
            Simulation
          </Button>
          <Button
            className={mode === "testnet" ? "active" : ""}
            onClick={() => onModeChange("testnet")}
            type="button"
            variant="ghost"
          >
            Testnet
          </Button>
        </div>
        <Button
          className="primary-button"
          onClick={wallet ? onDisconnectWallet : onConnectWallet}
          type="button"
          variant="primary"
        >
          {actionLoading === "wallet"
            ? <Loader2 className="spin" size={16} />
            : wallet ? <XCircle size={16} /> : <Wallet size={16} />}
          {wallet ? "Disconnect" : "Connect Wallet"}
        </Button>
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
  const isSecondarySectionActive = navItems.some((item) => !item.primaryMobile && item.id === activeSection);

  return (
    <>
      <section className="mobile-bottom-nav" aria-label="Mobile sections">
        {navItems.filter((item) => item.primaryMobile).map((item) => (
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
        <Button
          className={isSecondarySectionActive ? "active" : ""}
          onClick={() => onMobileMoreChange(!mobileMoreOpen)}
          type="button"
          variant="ghost"
        >
          <Menu size={17} />
          <span>More</span>
        </Button>
      </section>

      {mobileMoreOpen ? (
        <section className="mobile-more-sheet" aria-label="More sections">
          {navItems.filter((item) => !item.primaryMobile).map((item) => (
            <Button
              className={activeSection === item.id ? "active" : ""}
              key={item.id}
              onClick={() => {
                onSectionChange(item.id);
                onMobileMoreChange(false);
              }}
              type="button"
              variant="secondary"
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
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
