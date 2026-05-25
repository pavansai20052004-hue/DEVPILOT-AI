import type { Metadata } from "next";
import { PlainEnglishInfraPanel } from "@/components/plain-english-infra-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Plain English Infra | DevPilot AI",
  description: "Turn plain-English recovery requests into infrastructure actions.",
};

export default function InfraCommandPage() {
  return (
    <SectionPage
      kicker="Remediate"
      title="Plain English infra"
      description="Describe the recovery intent and let DevPilot translate it into a reviewed infrastructure plan."
    >
      <PlainEnglishInfraPanel />
    </SectionPage>
  );
}
