import type { Metadata } from "next";
import { Outfit, Nunito_Sans, JetBrains_Mono, Prompt, Fraunces } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { GoogleAnalytics } from "@/lib/analytics/ga";
import { UtmCapture } from "@/components/utm-capture";
import { ProfileGate } from "@/components/profile-gate";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const nunito = Nunito_Sans({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const prompt = Prompt({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-prompt", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["italic", "normal"], weight: ["400", "500", "600"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Vedam — One platform for your entire journey",
    template: "%s · Vedam",
  },
  description:
    "One login for the entire Vedam ecosystem — learn to code, predict your colleges, meet your seniors, and join every Vedam event, all in one place.",
  openGraph: {
    title: "Vedam — One platform for your entire journey",
    description: "One login for the entire Vedam ecosystem — learn, predict, connect, and grow.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} ${nunito.variable} ${jetbrains.variable} ${prompt.variable} ${fraunces.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <PostHogProvider>
            <UtmCapture />
            <ProfileGate />
            {children}
          </PostHogProvider>
        </ThemeProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
