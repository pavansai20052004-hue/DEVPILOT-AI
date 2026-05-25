import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { PanelLoading } from "@/components/panel-loading";

export const metadata: Metadata = {
  title: "Incident Dashboard | DevPilot AI",
  description:
    "DevPilot AI incident memory, analytics, auto-heal trends, and recovery impact.",
};

const AnalyticsDashboard = dynamic(
  () =>
    import("@/components/analytics-dashboard").then(
      (module) => module.AnalyticsDashboard,
    ),
  {
    loading: () => <PanelLoading label="Loading incident dashboard" />,
  },
);

export default function DashboardPage() {
  return <AnalyticsDashboard />;
}
