"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useMemo,
} from "react";
import { useAuth } from "@/components/auth-provider";
import {
  can,
  defaultRole,
  Permission,
  roleDescription,
  roleLabel,
  UserRole,
} from "@/lib/rbac";

type RoleContextValue = {
  role: UserRole;
  setRole: (role: UserRole) => void;
  can: (permission: Permission) => boolean;
  roleLabel: string;
  roleDescription: string;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const role = session?.role ?? defaultRole;

  const value = useMemo<RoleContextValue>(
    () => ({
      role,
      setRole() {},
      can(permission) {
        return can(role, permission);
      },
      roleLabel: roleLabel(role),
      roleDescription: roleDescription(role),
    }),
    [role],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRole must be used inside RoleProvider.");
  }

  return context;
}

export function RoleSwitcher({
  variant = "panel",
}: {
  variant?: "panel" | "compact";
}) {
  const { role, roleDescription: currentRoleDescription } = useRole();
  const currentRoleLabel = roleLabel(role);

  if (variant === "compact") {
    return (
      <div className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.045] px-3 text-sm shadow-2xl shadow-black/20">
        <span className="font-mono text-[11px] font-semibold uppercase text-zinc-400">
          Role
        </span>
        <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-sm font-semibold text-amber-50">
          {currentRoleLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="premium-panel p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-zinc-400">
        Active role
      </p>
      <p className="rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-50">
        {currentRoleLabel}
      </p>
      <p className="mt-2 max-w-56 text-xs leading-5 text-zinc-400">
        {currentRoleDescription}
      </p>
    </div>
  );
}
