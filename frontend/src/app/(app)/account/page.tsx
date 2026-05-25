import type { Metadata } from "next";
import { SaaSAccountPanel } from "@/components/saas-account-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Account & Billing | DevPilot AI",
  description: "Manage DevPilot AI team accounts, billing tiers, and usage.",
};

export default function AccountPage() {
  return (
    <SectionPage
      kicker="SaaS"
      title="Account & Billing"
      description="Run DevPilot as a multi-customer SaaS with team workspaces, plan limits, and usage tracking."
    >
      <SaaSAccountPanel />
    </SectionPage>
  );
}
