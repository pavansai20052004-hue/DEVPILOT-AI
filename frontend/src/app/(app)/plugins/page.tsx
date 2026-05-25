import type { Metadata } from "next";
import { PluginMarketplacePanel } from "@/components/plugin-marketplace-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Plugins | DevPilot AI",
  description: "Connect DevPilot to cloud, CI/CD, observability, and collaboration tools.",
};

export default function PluginsPage() {
  return (
    <SectionPage
      kicker="Enterprise"
      title="Plugin marketplace"
      description="Install and manage the integrations that connect DevPilot to your engineering stack."
    >
      <PluginMarketplacePanel />
    </SectionPage>
  );
}
