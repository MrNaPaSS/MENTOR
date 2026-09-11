// Подпись бренда: тёмная полоса со свечами, NMNH.TRADE и девиз.
//
// Свечи рисуются здесь же, а не картинкой: полоса тянется на любую ширину, и
// картинка на ней либо плыла бы, либо резалась. Высоты заданы списком, а не
// случайно - полоса одинакова при каждом открытии и на сервере, и в браузере.

const CANDLES = [38, 62, 45, 80, 55, 30, 70, 48, 90, 58, 35, 66, 52, 76, 42, 60, 84, 46, 64, 36, 72, 50, 88, 56];

export default function BrandStrip({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-accent-gold/30 px-4 py-3 text-center ${className}`}
      style={{ background: "linear-gradient(180deg, #0d0d10, #07070a)" }}
    >
      <svg
        aria-hidden
        viewBox="0 0 240 60"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-35"
      >
        {CANDLES.map((h, i) => {
          const x = 4 + i * 10;
          const body = h * 0.42;
          const top = 60 - body - 6;
          const gold = i % 3 !== 1;
          return (
            <g key={i} fill={gold ? "#e0a800" : "#9aa0a6"} stroke={gold ? "#e0a800" : "#9aa0a6"}>
              <line x1={x + 2} x2={x + 2} y1={top - 5} y2={top + body + 4} strokeWidth={0.6} />
              <rect x={x} y={top} width={4} height={body} rx={0.6} />
            </g>
          );
        })}
      </svg>
      <p className="relative text-[15px] font-extrabold tracking-wide text-white">NMNH.TRADE</p>
      <p className="relative mt-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-[#f0b90b]">
        Discipline creates freedom
      </p>
    </div>
  );
}
