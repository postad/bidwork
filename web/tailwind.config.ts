import type { Config } from "tailwindcss";

// bw- design tokens — the exact palette from the mockups / spec.html.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bw-bg": "#FFFFFF",
        "bw-surface": "#F7F7F7",
        "bw-text": "#001E00",
        "bw-body": "#5E6D55",
        "bw-muted": "#8E9C8B",
        "bw-border": "#E5E7EB",
        "bw-green": "#14A800",
        "bw-green-hover": "#108A00",
        "bw-green-deep": "#0B6B00",
        "bw-green-tint": "#E8F5E4",
        "bw-green-tint-2": "#D6EDCC",
        "bw-dark": "#0F1410",
        "bw-dark-2": "#171D17",
        "bw-dark-muted": "#A8B3A5",
        "bw-amber": "#B45309",
        "bw-amber-tint": "#FEF3C7",
        "bw-blue": "#1D4ED8",
        "bw-blue-tint": "#DBEAFE",
        "bw-red": "#B91C1C",
        "bw-red-tint": "#FEE2E2",
        "bw-purple": "#6D28D9",
        "bw-purple-tint": "#EDE9FE",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
