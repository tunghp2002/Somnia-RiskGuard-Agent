"use client";

import { KeyRound } from "lucide-react";

import { GuardianSettings, InheritanceSettings } from "@/features/settings/guardian-settings";
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
  SafetyReceipts
} from "./components/dashboard-sections";
import {
  GuardianStatus,
  HeartbeatPanel,
  PanelHeading,
  RewardPanel,
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

        {state.notice ? <div className={`notice ${state.notice.tone}`}>{state.notice.message}</div> : null}

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
            <HeartbeatPanel heartbeat={state.heartbeat} />
            <RewardPanel rewards={state.rewards} />
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

          {state.activeSection === "setup" ? (
            <section className="panel">
              <PanelHeading icon={<KeyRound size={17} />} title="Configuration" action="signed where required" />
              <GuardianSettings
                actionLoading={state.actionLoading}
                onRegisterWallet={actions.handleRegisterWallet}
                onRewardsSubmit={actions.handleRewardsSubmit}
                onTelegramConnect={actions.handleTelegramConnect}
                telegramSession={state.telegramSession}
              />
            </section>
          ) : null}

          {state.activeSection === "inheritance" ? (
            <section className="inheritance-panel">
              <InheritanceSettings
                actionLoading={state.actionLoading}
                onHeartbeatSubmit={actions.handleHeartbeatSubmit}
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

          {state.activeSection === "heartbeat" ? <HeartbeatPanel heartbeat={state.heartbeat} /> : null}
          {state.activeSection === "rewards" ? <RewardPanel rewards={state.rewards} /> : null}
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
