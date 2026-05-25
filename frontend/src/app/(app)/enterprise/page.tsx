import type { Metadata } from "next";
import { EnterpriseCommandCenter } from "@/components/enterprise-command-center";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Command Center | DevPilot AI",
  description: "Manage enterprise teams, clusters, regions, and recovery posture.",
};

export default function EnterprisePage() {
  return (
    <SectionPage
      kicker="Enterprise"
      title="Command center"
      description="Operate teams, clusters, regions, policies, and recovery commands from one DevOps workspace."
    >
      <EnterpriseCommandCenter />
    </SectionPage>
  );
}
