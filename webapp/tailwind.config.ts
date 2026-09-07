import type { Config } from "tailwindcss";

// Палитра и токены дизайн-системы NMNH (ТЗ §10)
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  future: {
    // На тач-устройствах тап срабатывает как наведение, и hover-состояние
    // «залипает» после нажатия. Флаг заворачивает hover: в
    // @media (hover: hover) and (pointer: fine), где ему и место.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        // Биржевые нейтрали уровня Binance/Bybit Pro. Значения приходят из
        // переменных каналами, поэтому у классов работает и прозрачность
        // (bg-bg-deep/80), и подмена всей палитры светлой темой.
        bg: {
          deep: "rgb(var(--bg-deep) / <alpha-value>)",
          card: "rgb(var(--bg-card) / <alpha-value>)",
          panel: "rgb(var(--bg-panel) / <alpha-value>)",
        },
        accent: {
          cyan: "rgb(var(--accent-cyan) / <alpha-value>)",
          gold: "rgb(var(--accent-gold) / <alpha-value>)",
        },
        text: {
          primary: "rgb(var(--text-primary) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warning: "rgb(var(--accent-gold) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          accent: "rgb(var(--accent-cyan) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      fontSize: {
        h1: ["clamp(2.75rem, 6vw, 4rem)", { lineHeight: "1.05", fontWeight: "800" }],
        h2: ["clamp(2rem, 4vw, 2.5rem)", { lineHeight: "1.1", fontWeight: "700" }],
        h3: ["1.75rem", { lineHeight: "1.2", fontWeight: "600" }],
      },
      boxShadow: {
        "glow-cyan": "0 0 0 1px rgb(var(--accent-cyan) / 0.45), 0 0 28px rgb(var(--accent-cyan) / 0.18)",
        "glow-gold": "0 0 0 1px rgba(255,215,0,0.45), 0 0 28px rgba(255,215,0,0.16)",
        "glow-soft": "0 0 40px rgb(var(--accent-cyan) / 0.10)",
        card: "0 8px 30px rgba(0,0,0,0.40)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(42,42,62,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(42,42,62,0.4) 1px, transparent 1px)",
        "radial-cyan":
          "radial-gradient(60% 60% at 50% 0%, rgb(var(--accent-cyan) / 0.12) 0%, transparent 70%)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "dialog-in": {
          "0%": { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 1px rgb(var(--accent-cyan) / 0.35), 0 0 16px rgb(var(--accent-cyan) / 0.10)" },
          "50%": { boxShadow: "0 0 0 1px rgb(var(--accent-cyan) / 0.7), 0 0 30px rgb(var(--accent-cyan) / 0.30)" },
        },
        "price-flash": {
          "0%": { backgroundColor: "rgb(var(--accent-cyan) / 0.22)" },
          "100%": { backgroundColor: "transparent" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "dash-move": {
          to: { strokeDashoffset: "-1000" },
        },
      },
      animation: {
        // Появление окна: ease-out и меньше двухсот миллисекунд. Диалог
        // перекрывает рабочий экран, и мгновенная подмена читается как сбой,
        // а долгая — как задержка интерфейса.
        "fade-in": "fade-in 0.12s ease-out both",
        "dialog-in": "dialog-in 0.18s cubic-bezier(0.22,1,0.36,1) both",
        "fade-up": "fade-up 0.6s cubic-bezier(0.22,1,0.36,1) both",
        "slide-down": "slide-down 0.5s cubic-bezier(0.22,1,0.36,1) both",
        shimmer: "shimmer 1.6s linear infinite",
        marquee: "marquee 40s linear infinite",
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
        "price-flash": "price-flash 0.6s ease-out",
        float: "float 6s ease-in-out infinite",
        "dash-move": "dash-move 18s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
