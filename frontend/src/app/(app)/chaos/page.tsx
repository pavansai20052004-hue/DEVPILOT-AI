import type { Metadata } from "next";
import { ChaosEngineeringPanel } from "@/components/chaos-engineering-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Chaos Engineering | DevPilot AI",
  description: "Inject controlled failures and validate DevPilot recovery.",
};

export default function ChaosPage() {
  return (
    <SectionPage
      kicker="Remediate"
      title="Chaos engineering"
      description="Run controlled failure scenarios and inspect the detection, remediation, and recovery timeline."
    >
      <ChaosEngineeringPanel />
    </SectionPage>
  );
}
