import type { Config } from "tailwindcss";

/**
 * Vedam design tokens. Colours are RGB channels in globals.css, referenced
 * here as rgb(var(--token) / <alpha-value>) so opacity modifiers keep working
 * in both themes.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-warm": "rgb(var(--surface-warm) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        heading: "rgb(var(--heading) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        // Communication module: lighter violet for focus rings / links (same in both themes)
        "accent-soft": "#B47BFF",
        "violet-deep": "rgb(var(--violet-deep) / <alpha-value>)",
        // VSAT admin (src/components/admin/ui/vx.ts): Vedam brand colours tuned for the dark admin surface
        vx: {
          ink: "#f5f3ff", mut: "#aca6d4", faint: "#8a84b5", raised: "#16123a",
          violet: "#8a18ff", "violet-t": "#c4a1ff", orange: "#f97d03", "orange-t": "#ffb35c",
          green: "#2bd99f", teal: "#00cfe5", "teal-t": "#7ce9f5", red: "#ff6b81",
          line: "rgba(170,160,255,0.11)", line2: "rgba(170,160,255,0.22)", "line-soft": "rgba(170,160,255,0.07)",
        },
        // PeerPath (Talk to a Senior) — values live on the .pp wrapper in peerpath.css
        pp: {
          page: "rgb(var(--pp-page) / <alpha-value>)",
          card: "rgb(var(--pp-card) / <alpha-value>)",
          soft: "rgb(var(--pp-soft) / <alpha-value>)",
          line: "rgb(var(--pp-line) / <alpha-value>)",
          ink: "rgb(var(--pp-ink) / <alpha-value>)",
          muted: "rgb(var(--pp-muted) / <alpha-value>)",
          heading: "rgb(var(--pp-heading) / <alpha-value>)",
          cream: "rgb(var(--pp-cream) / <alpha-value>)",
          violet: {
            50: "rgb(var(--pp-violet-50) / <alpha-value>)",
            100: "rgb(var(--pp-violet-100) / <alpha-value>)",
            200: "rgb(var(--pp-violet-200) / <alpha-value>)",
            500: "rgb(var(--pp-violet-500) / <alpha-value>)",
            600: "rgb(var(--pp-violet-600) / <alpha-value>)",
            700: "rgb(var(--pp-violet-700) / <alpha-value>)",
          },
          orange: {
            50: "rgb(var(--pp-orange-50) / <alpha-value>)",
            500: "rgb(var(--pp-orange-500) / <alpha-value>)",
            700: "rgb(var(--pp-orange-700) / <alpha-value>)",
          },
        },
      },
      fontFamily: {
        display: ["var(--font-outfit)", "system-ui", "sans-serif"],
        sans: ["var(--font-outfit)", "system-ui", "sans-serif"],
        body: ["var(--font-nunito)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
        prompt: ["var(--font-prompt)", "serif"],
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(120deg, #F97D03 0%, #E80074 46%, #8A18FF 100%)",
      },
      boxShadow: {
        "pp-card": "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(20,6,50,0.35)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
