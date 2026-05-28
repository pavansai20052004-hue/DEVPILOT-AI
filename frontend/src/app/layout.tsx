import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { RoleProvider } from "@/components/role-provider";
import { TeamProvider } from "@/components/team-provider";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-devpilot-mono",
});

export const metadata: Metadata = {
  title: "DevPilot AI - Your AI DevOps Engineer",
  description: "AI teammate for DevOps engineers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <TeamProvider>
            <RoleProvider>{children}</RoleProvider>
          </TeamProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
