import type { Metadata } from "next";
import { Gauge, Zap, ShieldCheck } from "lucide-react";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import Badge from "@/components/ui/Badge";
import Calculator from "@/components/Calculator";

export const metadata: Metadata = {
  title: "Калькулятор позиции",
  description:
    "Рассчитай маржу, объём, риск и профит по каждому тейк-профиту под свой депозит — бесплатно. Умеренный и турбо режимы.",
  alternates: { canonical: "/calculator" },
};

const INFO = [
  {
    icon: Gauge,
    title: "Умеренный режим",
    text: "Плечо до 25x, риск 1–5% на сделку. Стоп фиксированный, цель — стабильный рост депозита.",
  },
  {
    icon: Zap,
    title: "Турбо режим",
    text: "Плечо до 400x для агрессивной торговли. Маленькая маржа, большой объём — повышенный риск.",
  },
  {
    icon: ShieldCheck,
    title: "Адаптивный стоп",
    text: "В турбо стоп автоматически держится с запасом до цены ликвидации — он всегда срабатывает.",
  },
];

export default function CalculatorPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28 md:px-6 md:pt-32">
        <div className="flex justify-center">
          <Badge variant="cyan">Бесплатный инструмент</Badge>
        </div>
        <SectionHeading
          className="mt-4"
          eyebrow="Калькулятор"
          title="Посчитай позицию до входа"
          subtitle="Маржа, объём, риск и профит по каждому тейк-профиту — мгновенно и под твой депозит."
        />

        <Reveal className="mt-12">
          <Calculator />
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {INFO.map(({ icon: Icon, title, text }) => (
            <Reveal key={title} className="card">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{text}</p>
            </Reveal>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-text-muted">
          Расчёт носит ознакомительный характер и не является финансовым советом. Торговля с плечом
          сопряжена с риском потери депозита.
        </p>
      </main>
      <Footer />
    </>
  );
}
