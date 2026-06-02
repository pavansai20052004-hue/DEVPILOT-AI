import type { Metadata } from "next";
import { ProductionMonitoringPanel } from "@/components/production-monitoring-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Production Monitoring | DevPilot AI",
  description:
    "Monitor DevPilot AI production readiness, CI/CD checks, integrations, and beta user feedback.",
};

export default function MonitoringPage() {
  return (
    <SectionPage
      kicker="Production"
      title="Production Monitoring"
      description="Track live deployment health, readiness signals, CI/CD coverage, and real beta user feedback from one operator view."
    >
      <ProductionMonitoringPanel />
    </SectionPage>
  );
}
