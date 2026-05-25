import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { PanelLoading } from "@/components/panel-loading";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Fix Pull Request | DevPilot AI",
  description: "Generate DevOps remediation files and open a pull request.",
};

const FixPullRequestPanel = dynamic(
  () =>
    import("@/components/fix-pull-request-panel").then(
      (module) => module.FixPullRequestPanel,
    ),
  {
    loading: () => <PanelLoading label="Loading fix generation" />,
  },
);

export default function FixPullRequestPage() {
  return (
    <SectionPage
      kicker="Remediate"
      title="Fix pull request"
      description="Generate cloud-specific remediation files and prepare a branch with the fix your team can review."
    >
      <FixPullRequestPanel />
    </SectionPage>
  );
}
