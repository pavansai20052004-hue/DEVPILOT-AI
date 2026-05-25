export type UserRole = "admin" | "devops_engineer" | "viewer";

export type Permission =
  | "upload_logs"
  | "generate_fixes"
  | "create_pull_requests"
  | "inspect_cluster"
  | "recover_cluster"
  | "patch_terraform"
  | "run_auto_heal"
  | "run_agents"
  | "approve_agent_actions"
  | "run_chaos"
  | "manage_integrations"
  | "manage_billing"
  | "view_dashboard";

export const roleOptions: {
  id: UserRole;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: "admin",
    label: "Admin",
    shortLabel: "Admin",
    description: "Full access to detection, remediation, recovery, and analytics.",
  },
  {
    id: "devops_engineer",
    label: "DevOps Engineer",
    shortLabel: "DevOps",
    description: "Can diagnose incidents and run manual recovery, but cannot Auto Heal.",
  },
  {
    id: "viewer",
    label: "Viewer",
    shortLabel: "Viewer",
    description: "Read-only access to dashboards, memory, and cluster status.",
  },
];

export const defaultRole: UserRole = "viewer";

const rolePermissions: Record<UserRole, Set<Permission>> = {
  admin: new Set([
    "upload_logs",
    "generate_fixes",
    "create_pull_requests",
    "inspect_cluster",
    "recover_cluster",
    "patch_terraform",
    "run_auto_heal",
    "run_agents",
    "approve_agent_actions",
    "run_chaos",
    "manage_integrations",
    "manage_billing",
    "view_dashboard",
  ]),
  devops_engineer: new Set([
    "upload_logs",
    "generate_fixes",
    "create_pull_requests",
    "inspect_cluster",
    "recover_cluster",
    "patch_terraform",
    "approve_agent_actions",
    "manage_integrations",
    "manage_billing",
    "view_dashboard",
  ]),
  viewer: new Set(["inspect_cluster", "view_dashboard"]),
};

export function isUserRole(value: string | null): value is UserRole {
  return roleOptions.some((role) => role.id === value);
}

export function roleLabel(role: UserRole) {
  return roleOptions.find((option) => option.id === role)?.label ?? "Viewer";
}

export function roleDescription(role: UserRole) {
  return roleOptions.find((option) => option.id === role)?.description ?? "";
}

export function can(role: UserRole, permission: Permission) {
  return rolePermissions[role].has(permission);
}

export function devPilotRoleHeaders(role: UserRole) {
  void role;
  return {};
}
