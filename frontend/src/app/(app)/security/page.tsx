import type { Metadata } from "next";
import { SectionPage } from "@/components/section-page";
import { SecurityAnalysisPanel } from "@/components/security-analysis-panel";

export const metadata: Metadata = {
  title: "Security Analysis | DevPilot AI",
  description: "Scan deployment and configuration security risks.",
};

export default function SecurityPage() {
  return (
    <SectionPage
      kicker="Enterprise"
      title="Security analysis"
      description="Find secrets, unsafe defaults, and Kubernetes or Dockerfile risks before they ship."
    >
      <SecurityAnalysisPanel />
    </SectionPage>
  );
}
