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

export default function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="Как это работает"
        title="От регистрации до первой сделки"
        subtitle="Четыре шага — и ты получаешь сигналы, рассчитанные под твой депозит."
      />

      <div className="relative mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Соединительная линия (десктоп) */}
        <div className="pointer-events-none absolute left-0 right-0 top-12 hidden h-px bg-gradient-to-r from-transparent via-accent-cyan/30 to-transparent lg:block" />

        {HOW_STEPS.map((step, i) => {
          const Icon = ICONS[step.icon];
          return (
            <Reveal as="article" key={step.num} delay={i * 0.12}>
              <div className="group relative h-full rounded-2xl border border-border bg-bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/50 hover:shadow-glow-soft">
                <span className="absolute right-5 top-4 font-mono text-3xl font-bold text-accent-gold/30 transition group-hover:text-accent-gold/60">
                  {step.num}
                </span>
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25 transition group-hover:shadow-glow-cyan">
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.text}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
