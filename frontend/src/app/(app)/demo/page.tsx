import type { Metadata } from "next";
import { DemoModePanel } from "@/components/demo-mode-panel";
import { JudgeModePanel } from "@/components/judge-mode-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Demo Mode | DevPilot AI",
  description: "Run a complete DevPilot incident demo from sample failure to dashboard.",
};

export default function DemoPage() {
  return (
    <SectionPage
      kicker="Enterprise"
      title="Demo mode"
      description="Run the full incident story: sample failure, diagnosis, fix generation, auto-heal, and dashboard result."
    >
      <JudgeModePanel />
      <DemoModePanel />
    </SectionPage>
  );
}
