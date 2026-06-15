import { Wallet, Bot, Calculator, TrendingUp, type LucideIcon } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { HOW_STEPS } from "@/lib/content";

const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  bot: Bot,
  calculator: Calculator,
  trending: TrendingUp,
};

const GRADIENTS = [
  "from-cyan-500/20 to-blue-500/10",
  "from-purple-500/20 to-pink-500/10",
  "from-amber-500/20 to-orange-500/10",
  "from-emerald-500/20 to-teal-500/10",
];
const ICON_COLORS = [
  { bg: "bg-cyan-500/15 ring-cyan-500/30", text: "text-cyan-400", glow: "shadow-[0_0_24px_rgba(6,182,212,0.35)]" },
  { bg: "bg-purple-500/15 ring-purple-500/30", text: "text-purple-400", glow: "shadow-[0_0_24px_rgba(168,85,247,0.35)]" },
  { bg: "bg-amber-500/15 ring-amber-500/30", text: "text-amber-400", glow: "shadow-[0_0_24px_rgba(245,158,11,0.35)]" },
  { bg: "bg-emerald-500/15 ring-emerald-500/30", text: "text-emerald-400", glow: "shadow-[0_0_24px_rgba(16,185,129,0.35)]" },
];

export default function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="Как это работает"
        title="От регистрации до первой сделки"
        subtitle="Четыре шага — и ты получаешь сигналы, рассчитанные под твой депозит."
      />

      <div className="relative mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Соединительная линия */}
        <div className="pointer-events-none absolute left-0 right-0 top-10 hidden h-px lg:block"
          style={{ background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.15) 20%, rgba(6,182,212,0.4) 50%, rgba(6,182,212,0.15) 80%, transparent)" }}
        />

        {HOW_STEPS.map((step, i) => {
          const Icon = ICONS[step.icon];
          const col = ICON_COLORS[i % ICON_COLORS.length];
          const grad = GRADIENTS[i % GRADIENTS.length];
          return (
            <Reveal as="article" key={step.num} delay={i * 0.12}>
              <div
                className={`group relative h-full overflow-hidden rounded-2xl border border-white/8 p-px transition-all duration-500 hover:-translate-y-2`}
                style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)" }}
              >
                {/* Gradient glow на hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${grad} opacity-0 transition-opacity duration-500 group-hover:opacity-100`} />

                {/* Border gradient */}
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.4), transparent 60%)", WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "destination-out", padding: "1px" }}
                />

                <div className="relative z-10 flex h-full flex-col p-6">
                  {/* Номер шага */}
                  <span
                    className="absolute right-4 top-3 select-none font-mono text-6xl font-black leading-none transition-all duration-300 group-hover:opacity-60"
                    style={{ color: "rgba(255,255,255,0.04)", WebkitTextStroke: "1px rgba(255,255,255,0.08)" }}
                  >
                    {step.num}
                  </span>

                  {/* Иконка */}
                  <span className={`relative z-10 grid h-14 w-14 place-items-center rounded-2xl ring-1 transition-all duration-300 group-hover:${col.glow} ${col.bg} ${col.text}`}>
                    <Icon className="h-7 w-7" />
                  </span>

                  <h3 className="mt-5 text-lg font-bold text-white">{step.title}</h3>
                  <p className="mt-2.5 flex-1 text-sm leading-relaxed text-text-secondary">{step.text}</p>

                  {/* Нижний акцент */}
                  <div className={`mt-5 h-0.5 w-8 rounded-full ${col.text} bg-current opacity-40 transition-all duration-300 group-hover:w-full group-hover:opacity-70`} />
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
