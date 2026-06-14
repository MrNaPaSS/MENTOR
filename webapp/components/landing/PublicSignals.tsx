"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, TrendingUp, TrendingDown } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { api, SignalOut } from "@/lib/api";
import { isLong } from "@/lib/format";

function SignalCard({ s }: { s: SignalOut }) {
  const long = isLong(s.direction);
  const active = s.status === "active";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-bg-card transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/40">
      {/* Открытая часть */}
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-white">{s.symbol}</span>
            <span className={long ? "badge-success" : "badge-danger"}>
              {long ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {s.direction}
            </span>
          </div>
          <span className={active ? "badge-success" : "badge-muted"}>
            {active ? "🟢 АКТИВЕН" : "⚫ ЗАКРЫТ"}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm text-text-muted">
          <span>
            Плечо <span className="font-mono font-semibold text-accent-cyan">x{s.leverage}</span>
          </span>
          <span className="uppercase">{s.margin_type}</span>
        </div>
      </div>

      {/* Закрытая (размытая) часть с расчётом */}
      <div className="relative border-t border-border">
        <div className="select-none p-5 blur-[7px]" aria-hidden>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm text-text-secondary">
            <span>Вход: 0000.00$</span>
            <span>Стоп: 0000.00$</span>
            <span>TP1: 0000.00$</span>
            <span>TP2: 0000.00$</span>
          </div>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-deep/40">
          <Lock className="h-5 w-5 text-accent-cyan" />
          <p className="text-sm font-medium text-white">Войдите чтобы увидеть расчёт</p>
          <Link href="/login" className="btn-outline mt-1 px-4 py-1.5 text-xs">
            Войти →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PublicSignals() {
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .activeSignals()
      .then((s) => (s.length ? s : api.signals()))
      .then((s) => setSignals(s.slice(0, 6)))
      .catch(() => setSignals([]))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <section id="signals" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="Лента сигналов"
        title="Последние сигналы платформы"
        subtitle="Направление и плечо видны всем. Точные цены и расчёт — после входа."
      />

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!loaded &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 rounded-2xl border border-border bg-bg-card">
              <div className="skeleton m-5 h-6 w-32" />
              <div className="skeleton mx-5 h-4 w-24" />
            </div>
          ))}

        {loaded && signals.length === 0 && (
          <p className="col-span-full text-center text-text-muted">
            Сигналов пока нет — загляни позже.
          </p>
        )}

        {signals.map((s, i) => (
          <Reveal key={s.id} delay={i * 0.08}>
            <SignalCard s={s} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
