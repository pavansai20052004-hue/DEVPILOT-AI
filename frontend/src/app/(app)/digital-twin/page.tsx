import type { Metadata } from "next";
import { InfrastructureDigitalTwinPanel } from "@/components/infrastructure-digital-twin-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Digital Twin | DevPilot AI",
  description: "Visualize infrastructure topology and incident blast radius.",
};

export default function DigitalTwinPage() {
  return (
    <SectionPage
      kicker="Enterprise"
      title="Infrastructure digital twin"
      description="Visualize services, dependencies, regions, risk, and the likely blast radius of an incident."
    >
      <InfrastructureDigitalTwinPanel />
    </SectionPage>
  );
}
