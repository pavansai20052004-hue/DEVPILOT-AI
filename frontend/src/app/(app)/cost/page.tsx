import type { Metadata } from "next";
import { CloudCostOptimizationPanel } from "@/components/cloud-cost-optimization-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Cloud Cost | DevPilot AI",
  description: "Optimize cloud spend and find idle infrastructure.",
};

export default function CostPage() {
  return (
    <SectionPage
      kicker="Enterprise"
      title="Cloud cost optimization"
      description="Detect idle resources, right-size low-utilization workloads, and estimate monthly savings."
    >
      <CloudCostOptimizationPanel />
    </SectionPage>
  );
}
