import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { PanelLoading } from "@/components/panel-loading";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Auto Heal | DevPilot AI",
  description: "Run DevPilot safe-mode recovery actions for incidents.",
};

const AutoHealPanel = dynamic(
  () => import("@/components/auto-heal-panel").then((module) => module.AutoHealPanel),
  {
    loading: () => <PanelLoading label="Loading auto-heal controls" />,
  },
);

export default function AutoHealPage() {
  return (
    <SectionPage
      kicker="Operate"
      title="Auto heal"
      description="Let DevPilot run the recovery sequence, record every action, and keep engineers in control through role permissions."
    >
      <AutoHealPanel />
    </SectionPage>
  );
}
