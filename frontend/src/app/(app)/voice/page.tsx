import type { Metadata } from "next";
import { SectionPage } from "@/components/section-page";
import { VoiceAssistantPanel } from "@/components/voice-assistant-panel";

export const metadata: Metadata = {
  title: "Voice Assistant | DevPilot AI",
  description: "Ask DevPilot to explain incidents and recovery actions.",
};

export default function VoicePage() {
  return (
    <SectionPage
      kicker="AI Engineer"
      title="Voice assistant"
      description="Ask DevPilot what failed, what changed, and which recovery action was applied."
    >
      <VoiceAssistantPanel />
    </SectionPage>
  );
}
