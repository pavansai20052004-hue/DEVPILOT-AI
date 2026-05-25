export type NavigationItem = {
  href: string;
  label: string;
  description: string;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Operate",
    items: [
      {
        href: "/dashboard",
        label: "Incident Dashboard",
        description: "Memory, trend, reports, and recovery ROI.",
      },
      {
        href: "/logs",
        label: "Log Intake",
        description: "Upload production logs for diagnosis.",
      },
      {
        href: "/kubernetes",
        label: "Kubernetes",
        description: "Inspect pods, restart workloads, and roll back.",
      },
      {
        href: "/auto-heal",
        label: "Auto Heal",
        description: "Run safe recovery actions for unhealthy services.",
      },
    ],
  },
  {
    label: "AI Engineer",
    items: [
      {
        href: "/agents",
        label: "Autonomous Agents",
        description: "Review AI fixes before recovery actions apply.",
      },
      {
        href: "/voice",
        label: "Voice Assistant",
        description: "Ask DevPilot to explain the active incident.",
      },
      {
        href: "/predictive-failures",
        label: "Failure Prediction",
        description: "Spot warning patterns before they page you.",
      },
      {
        href: "/model-training",
        label: "Model Training",
        description: "Train and evaluate the incident model.",
      },
    ],
  },
  {
    label: "Remediate",
    items: [
      {
        href: "/terraform",
        label: "Terraform",
        description: "Detect drift and generate reviewed patches.",
      },
      {
        href: "/fix-pr",
        label: "Fix Pull Request",
        description: "Create remediation branches and pull requests.",
      },
      {
        href: "/infra-command",
        label: "Plain English Infra",
        description: "Turn recovery requests into executable plans.",
      },
      {
        href: "/chaos",
        label: "Chaos Engineering",
        description: "Inject failures and watch recovery behavior.",
      },
    ],
  },
  {
    label: "Enterprise",
    items: [
      {
        href: "/account",
        label: "Account & Billing",
        description: "Teams, plan limits, and customer usage.",
      },
      {
        href: "/enterprise",
        label: "Command Center",
        description: "Teams, clusters, regions, and fleet controls.",
      },
      {
        href: "/digital-twin",
        label: "Digital Twin",
        description: "Map infrastructure topology and blast radius.",
      },
      {
        href: "/security",
        label: "Security",
        description: "Scan configuration and deployment risks.",
      },
      {
        href: "/cost",
        label: "Cloud Cost",
        description: "Find idle resources and savings opportunities.",
      },
      {
        href: "/plugins",
        label: "Plugins",
        description: "Connect cloud, CI/CD, observability, and chat.",
      },
      {
        href: "/demo",
        label: "Demo Mode",
        description: "Run the complete DevPilot incident story.",
      },
    ],
  },
];

export const flatNavigation = navigationGroups.flatMap((group) => group.items);
