import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { PanelLoading } from "@/components/panel-loading";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Log Intake | DevPilot AI",
  description: "Upload production logs and start DevPilot incident diagnosis.",
};

const LogUploadPanel = dynamic(
  () => import("@/components/log-upload-panel").then((module) => module.LogUploadPanel),
  {
    loading: () => <PanelLoading label="Loading log intake" />,
  },
);

export default function LogsPage() {
  return (
    <SectionPage
      kicker="Operate"
      title="Log intake"
      description="Paste or upload incident logs so DevPilot can extract the failure signal, severity, and recommended fix."
    >
      <LogUploadPanel />
    </SectionPage>
  );
}
