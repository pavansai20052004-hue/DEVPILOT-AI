import type { Metadata } from "next";
import { PredictiveFailurePanel } from "@/components/predictive-failure-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Failure Prediction | DevPilot AI",
  description: "Predict repeat incident patterns before they become outages.",
};

export default function PredictiveFailuresPage() {
  return (
    <SectionPage
      kicker="AI Engineer"
      title="Failure prediction"
      description="Compare fresh runtime signals against incident memory to catch risky patterns before they escalate."
    >
      <PredictiveFailurePanel />
    </SectionPage>
  );
}
