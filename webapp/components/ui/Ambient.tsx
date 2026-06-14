/** Фоновое свечение + сетка для зон кабинета/админки (премиум-глубина, без WebGL). */
export default function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-48 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-accent-cyan/[0.10] blur-[130px]" />
      <div className="absolute -right-40 top-1/3 h-[420px] w-[520px] rounded-full bg-accent-gold/[0.05] blur-[130px]" />
      <div className="absolute bottom-[-20%] left-[-10%] h-[460px] w-[560px] rounded-full bg-[#6d28d9]/[0.06] blur-[140px]" />
      <div className="absolute inset-0 bg-grid-faint [background-size:46px_46px] opacity-[0.22] [mask-image:radial-gradient(90%_60%_at_50%_0%,black,transparent)]" />
    </div>
  );
}
