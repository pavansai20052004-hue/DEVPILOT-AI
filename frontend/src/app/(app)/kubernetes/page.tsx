import type { Metadata } from "next";
import { KubernetesClusterPanel } from "@/components/kubernetes-cluster-panel";
import { SectionPage } from "@/components/section-page";

export const metadata: Metadata = {
  title: "Kubernetes | DevPilot AI",
  description: "Inspect Kubernetes pods and run safe recovery actions.",
};

export default function KubernetesPage() {
  return (
    <SectionPage
      kicker="Operate"
      title="Kubernetes control"
      description="Inspect cluster health, find unhealthy pods, and run reviewed restart or rollback actions."
    >
      <KubernetesClusterPanel />
    </SectionPage>
  );
}
