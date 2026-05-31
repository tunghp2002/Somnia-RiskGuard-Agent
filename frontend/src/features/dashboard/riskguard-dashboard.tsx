"use client";

import { InheritanceSettings } from "@/features/settings/guardian-settings";

import { AccountAssetsPanel } from "./components/account-assets-panel";
import {
  DashboardHeader,
  DashboardSidebar,
  FloatingRefreshButton,
  MobileDashboardNav
} from "./components/dashboard-navigation";
import { DashboardNoticeToast } from "./components/dashboard-notice-toast";
import {
  ProfilePanel
} from "./components/dashboard-sections";
import {
  RiskPolicyGuard
} from "./components/status-panels";
import { TransferPanel } from "./components/transfer-panel";
import { useRiskGuardDashboard } from "./hooks/use-riskguard-dashboard";

export function RiskGuardDashboard() {
  const { state, actions } = useRiskGuardDashboard();

  return (
    <main className="rg-app-shell">
      <DashboardSidebar
        activeSection={state.activeSection}
        onSectionChange={actions.setActiveSection}
        publicChain={state.publicChain}
      />

      <div className="rg-shell">
        <DashboardHeader
          actionLoading={state.actionLoading}
          activeSection={state.activeSection}
          onConnectWallet={actions.handleConnectWallet}
          onDisconnectWallet={actions.handleDisconnectWallet}
          wallet={state.wallet}
        />

        <DashboardNoticeToast notice={state.notice} />

        {state.activeSection === "overview" ? (
          <section className="rg-overview">
            <AccountAssetsPanel
              accountOptions={state.accountOptions}
              onSelectedScopeChange={actions.setSelectedAssetAccountScope}
              publicChain={state.publicChain}
              selectedScope={state.selectedAssetAccountScope}
            />
            <RiskPolicyGuard
              actionLoading={state.actionLoading}
              config={state.riskGuardConfig}
              moduleReady={state.riskGuardModuleReady}
              onConfigure={actions.handleConfigureRiskPolicy}
              rules={state.riskGuardRules}
            />
          </section>
        ) : null}

        <section className="rg-grid">
          {state.activeSection === "profile" ? (
            <ProfilePanel
              actionLoading={state.actionLoading}
              onConnectTelegram={actions.handleTelegramConnect}
              onDisconnectTelegram={actions.handleTelegramUnlink}
              onDisconnectWallet={actions.handleDisconnectWallet}
              onProfileSubmit={actions.handleProfileSubmit}
              telegramSession={state.telegramSession}
              userProfile={state.userProfile}
              wallet={state.wallet}
            />
          ) : null}

          {state.activeSection === "transfer" ? (
            <TransferPanel
              actionLoading={state.actionLoading}
              estimateTransfer={actions.handleTransferEstimate}
              onConnectWallet={actions.handleConnectWallet}
              onTransferSubmit={actions.handleTransferSubmit}
              publicChain={state.publicChain}
              smartAccountAddress={state.activeInheritanceSmartAccount}
              wallet={state.wallet}
            />
          ) : null}

          {state.activeSection === "inheritance" ? (
            <section className="inheritance-panel">
              <InheritanceSettings
                actionLoading={state.actionLoading}
                inheritancePlan={state.inheritancePlan}
                onInheritanceCancel={actions.handleInheritancePlanCancel}
                onInheritanceSubmit={actions.handleInheritancePlanSubmit}
                onNotice={actions.showNotice}
                onSmartAccountChange={actions.setSelectedSmartAccountAddress}
                registryAddress={state.publicChain?.contracts.inheritanceRegistry}
                selectedSmartAccountAddress={state.selectedSmartAccountAddress}
                walletAddress={state.wallet?.address ?? state.activeWalletAddress}
              />
            </section>
          ) : null}
        </section>

        <MobileDashboardNav
          activeSection={state.activeSection}
          mobileMoreOpen={state.mobileMoreOpen}
          onMobileMoreChange={actions.setMobileMoreOpen}
          onSectionChange={actions.setActiveSection}
        />

        <FloatingRefreshButton onRefresh={() => void actions.loadData()} />
      </div>
    </main>
  );
}
