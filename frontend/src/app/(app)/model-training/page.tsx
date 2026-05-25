import type { Metadata } from "next";
import { CustomModelTrainingPanel } from "@/components/custom-model-training-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Model Training | DevPilot AI",
  description: "Train and evaluate the DevPilot incident model.",
};

export default function ModelTrainingPage() {
  return (
    <SectionPage
      kicker="AI Engineer"
      title="Model training"
      description="Build a fine-tuning-ready incident dataset and compare DevPilot's custom model against the generic baseline."
    >
      <CustomModelTrainingPanel />
    </SectionPage>
  );
}
