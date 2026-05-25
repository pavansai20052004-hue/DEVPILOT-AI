import type { Metadata } from "next";
import { SectionPage } from "@/components/section-page";
import { TerraformRemediationPanel } from "@/components/terraform-remediation-panel";

export const metadata: Metadata = {
  title: "Terraform Remediation | DevPilot AI",
  description: "Detect Terraform drift and generate reviewed remediation patches.",
};

export default function TerraformPage() {
  return (
    <SectionPage
      kicker="Remediate"
      title="Terraform remediation"
      description="Scan infrastructure-as-code drift, generate a corrected patch, and apply it only after review."
    >
      <TerraformRemediationPanel />
    </SectionPage>
  );
}
