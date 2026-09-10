import type { Metadata } from "next";
import { Outfit, Nunito_Sans, JetBrains_Mono, Prompt, Fraunces, Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import Script from "next/script";
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
const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], style: ["italic", "normal"], weight: ["500", "600"], variable: "--font-playfair", display: "swap" });

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
      <head>
        <Script id="gtm-head" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-MCCDDHDV');` }} />
      </head>
      <body className={`${outfit.variable} ${nunito.variable} ${jetbrains.variable} ${prompt.variable} ${fraunces.variable} ${inter.variable} ${playfair.variable}`}>
        <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MCCDDHDV" height="0" width="0" style={{ display: "none", visibility: "hidden" }} /></noscript>
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
