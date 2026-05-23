"use client";

import { InheritanceSettings } from "@/features/settings/guardian-settings";
import { DashboardNoticeToast } from "./components/dashboard-notice-toast";
import {
  DashboardHeader,
  DashboardSidebar,
  FloatingRefreshButton,
  MobileDashboardNav
} from "./components/dashboard-navigation";
import {
  DemoScenarioControl,
  OperatorHealth,
  PortfolioWatch,
  ProfilePanel,
  SafetyReceipts
} from "./components/dashboard-sections";
import {
  GuardianStatus,
  RiskScore
} from "./components/status-panels";
import { useRiskGuardDashboard } from "./hooks/use-riskguard-dashboard";

export function RiskGuardDashboard() {
  const { state, actions } = useRiskGuardDashboard();

  return (
    <main className="rg-app-shell">
      <DashboardSidebar
        activeSection={state.activeSection}
        mode={state.mode}
        onSectionChange={actions.setActiveSection}
        publicChain={state.publicChain}
      />

      <div className="rg-shell">
        <DashboardHeader
          accountStatus={state.accountStatus}
          actionLoading={state.actionLoading}
          activeSection={state.activeSection}
          mode={state.mode}
          onConnectWallet={actions.handleConnectWallet}
          onDisconnectWallet={actions.handleDisconnectWallet}
          onModeChange={actions.setMode}
          wallet={state.wallet}
        />

        <DashboardNoticeToast notice={state.notice} />

        {state.activeSection === "overview" ? (
          <section className="rg-overview">
            <GuardianStatus
              mode={state.mode}
              readiness={state.readiness}
              ready={state.guardianReady}
              wallet={state.wallet}
            />
            <RiskScore
              actionLoading={state.actionLoading}
              onAnalyzeRisk={actions.handleAnalyzeRisk}
              risk={state.risk}
              score={state.riskScore}
              tone={state.riskTone}
            />
            <PortfolioWatch loading={state.loading} portfolio={state.portfolio} />
          </section>
        ) : null}

        <section className="rg-grid">
          {state.activeSection === "risk" ? (
            <>
              <RiskScore
                actionLoading={state.actionLoading}
                onAnalyzeRisk={actions.handleAnalyzeRisk}
                risk={state.risk}
                score={state.riskScore}
                tone={state.riskTone}
              />
              <PortfolioWatch loading={state.loading} portfolio={state.portfolio} />
            </>
          ) : null}

          {state.activeSection === "profile" ? (
            <ProfilePanel
              actionLoading={state.actionLoading}
              onConnectTelegram={actions.handleTelegramConnect}
              onConnectWallet={actions.handleConnectWallet}
              onDisconnectWallet={actions.handleDisconnectWallet}
              onProfileSubmit={actions.handleProfileSubmit}
              telegramSession={state.telegramSession}
              userProfile={state.userProfile}
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
                registryAddress={state.publicChain?.contracts.inheritanceRegistry}
                walletAddress={state.wallet?.address ?? state.activeWalletAddress}
              />
            </section>
          ) : null}

          {state.activeSection === "demo" ? (
            <DemoScenarioControl
              actionLoading={state.actionLoading}
              mode={state.mode}
              onRunDemo={(scenario) => void actions.handleRunDemo(scenario)}
            />
          ) : null}

          {state.activeSection === "health" ? (
            <OperatorHealth
              health={state.health}
              publicChain={state.publicChain}
              readiness={state.readiness}
            />
          ) : null}

          {state.activeSection === "receipts" ? <SafetyReceipts receipts={state.receipts} /> : null}
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
