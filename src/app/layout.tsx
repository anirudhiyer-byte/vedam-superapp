import type { Metadata } from "next";
import { Outfit, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { GoogleAnalytics } from "@/lib/analytics/ga";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Vedam — One platform for your entire journey",
    template: "%s · Vedam",
  },
  description:
    "One login for the entire Vedam ecosystem — learn, predict your colleges, meet your seniors, and join events, all in one place.",
  openGraph: {
    title: "Vedam — One platform for your entire journey",
    description:
      "One login for the entire Vedam ecosystem — learn, predict, connect, and grow.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} ${nunito.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <PostHogProvider>{children}</PostHogProvider>
        </ThemeProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
