"use client";

import { InheritanceSettings } from "@/features/settings";

import { AccountAssetsPanel } from "./components/account";
import { AgentReviewRequestModal } from "./components/agent-review-modal";
import { ApprovalsPanel } from "./components/approvals-panel";
import {
  DashboardHeader,
  DashboardNoticeToast,
  DashboardSidebar,
  MobileDashboardNav,
  ProfilePanel
} from "./components/dashboard";
import {
  RiskPolicyGuard
} from "./components/status-panels";
import { TransferPanel } from "./components/transfer-panel";
import { useRiskGuardDashboard } from "@/hooks/dashboard";

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
        <AgentReviewRequestModal
          onClose={() => actions.setAgentReviewModal(null)}
          review={state.agentReviewModal}
        />

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
              onTelegramRequired={() =>
                actions.showNotice({
                  tone: "warn",
                  message:
                    "Connect Telegram first so RiskGuard can alert you about risky transactions, then enable the guard.",
                })
              }
              rules={state.riskGuardRules}
              telegramConnected={Boolean(state.telegramSession?.connected)}
            />
          </section>
        ) : null}

        <section className="rg-grid">
          {state.activeSection === "allowances" ? (
            <ApprovalsPanel
              publicChain={state.publicChain}
              walletAddress={state.wallet?.address ?? state.activeWalletAddress}
            />
          ) : null}

          {state.activeSection === "profile" ? (
            <ProfilePanel
              actionLoading={state.actionLoading}
              onConnectTelegram={actions.handleTelegramConnect}
              onDisconnectTelegram={actions.handleTelegramUnlink}
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
                inheritancePlanLoading={state.inheritancePlanLoading}
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
      </div>
    </main>
  );
}
