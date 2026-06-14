import type { Config } from "tailwindcss";

// Палитра NMNH (ТЗ §10.1)
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { deep: "#0A0A1A", card: "#1A1A2E", panel: "#0F0F23" },
        accent: { cyan: "#0AFFE0", gold: "#FFD700" },
        text: { primary: "#FFFFFF", secondary: "#CCCCCC", muted: "#666666" },
        success: "#00D4A0",
        danger: "#FF4757",
        border: { DEFAULT: "#2A2A3E", accent: "#0AFFE0" },
      },
      fontFamily: {
        sans: ["Inter", "SF Pro", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
