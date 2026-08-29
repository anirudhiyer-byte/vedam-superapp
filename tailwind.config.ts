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
        "violet-deep": "rgb(var(--violet-deep) / <alpha-value>)",
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
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
