/** Декоративный неоновый «график» на фоне героя (чистый SVG + CSS, без 3D). */
export default function ChartBackdrop({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 400"
      className={className}
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="cb-line" x1="0" y1="0" x2="600" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0AFFE0" stopOpacity="0" />
          <stop offset="0.5" stopColor="#0AFFE0" />
          <stop offset="1" stopColor="#FFD700" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="cb-fill" x1="0" y1="0" x2="0" y2="400" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0AFFE0" stopOpacity="0.18" />
          <stop offset="1" stopColor="#0AFFE0" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Заливка под линией */}
      <path
        d="M0 300 L60 280 L120 300 L180 220 L240 250 L300 160 L360 190 L420 110 L480 140 L540 70 L600 90 L600 400 L0 400 Z"
        fill="url(#cb-fill)"
      />
      {/* Основная неоновая линия */}
      <path
        d="M0 300 L60 280 L120 300 L180 220 L240 250 L300 160 L360 190 L420 110 L480 140 L540 70 L600 90"
        stroke="url(#cb-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 8px rgba(10,255,224,0.6))" }}
      />
      {/* Анимированная пунктирная линия тренда */}
      <path
        d="M0 340 C150 320 300 240 450 200 C520 180 560 150 600 150"
        stroke="#FFD700"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeDasharray="6 10"
        className="animate-dash-move"
      />
    </svg>
  );
}
