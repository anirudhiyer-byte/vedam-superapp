import type { Config } from "tailwindcss";

/**
 * Vedam design tokens.
 * Colours are defined as raw RGB channels in globals.css (:root and .dark)
 * and referenced here as rgb(var(--token) / <alpha-value>) so Tailwind
 * opacity modifiers (e.g. bg-primary/20) keep working in both themes.
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
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        // Brand core (constant across themes)
        primary: "rgb(var(--primary) / <alpha-value>)",       // Vedam Orange
        accent: "rgb(var(--accent) / <alpha-value>)",         // Electric Violet
        "violet-deep": "rgb(var(--violet-deep) / <alpha-value>)",
      },
      fontFamily: {
        // Bound to next/font CSS variables in the root layout.
        display: ["var(--font-outfit)", "system-ui", "sans-serif"],
        sans: ["var(--font-outfit)", "system-ui", "sans-serif"],
        body: ["var(--font-nunito)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #F97D03 0%, #8A18FF 100%)",
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
