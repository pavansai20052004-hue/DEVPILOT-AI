import { AppShell } from "@/components/app-shell";

export default function ProductAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}
