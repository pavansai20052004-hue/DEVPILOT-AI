import type { Metadata } from "next";
import { AutonomousAgentPanel } from "@/components/autonomous-agent-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Autonomous Agents | DevPilot AI",
  description: "Observe DevPilot's autonomous DevOps agent loop.",
};

export default function AgentsPage() {
  return (
    <SectionPage
      kicker="AI Engineer"
      title="Autonomous agents"
      description="Watch DevPilot monitor incidents, choose a remediation strategy, and coordinate recovery actions."
    >
      <AutonomousAgentPanel />
    </SectionPage>
  );
}
