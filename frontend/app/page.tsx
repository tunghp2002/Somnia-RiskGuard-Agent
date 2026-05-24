import { ThirdwebAppProvider } from "@/components/providers/thirdweb-app-provider";
import { RiskGuardDashboard } from "@/features/dashboard/riskguard-dashboard";

export default function HomePage() {
  return (
    <ThirdwebAppProvider>
      <RiskGuardDashboard />
    </ThirdwebAppProvider>
  );
}
