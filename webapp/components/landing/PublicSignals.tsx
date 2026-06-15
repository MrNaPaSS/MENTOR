"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, TrendingUp, TrendingDown, Zap } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { api, SignalOut } from "@/lib/api";
import { isLong } from "@/lib/format";

function SignalCard({ s }: { s: SignalOut }) {
  const long = isLong(s.direction);
  const active = s.status === "active";

  return (
    <div className="group relative overflow-hidden rounded-2xl border transition-all duration-300 border-white/10 bg-gradient-to-b from-bg-card to-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-accent-cyan/35 hover:shadow-[0_12px_40px_rgba(10,255,224,0.06)] hover:-translate-y-1"
    >
      {/* Мягкое радиальное свечение в углу */}
      <div className={`absolute -right-12 -top-12 h-32 w-32 rounded-full ${long ? "bg-success/4" : "bg-danger/4"} blur-3xl pointer-events-none transition-all duration-300 group-hover:scale-110`} />

      {/* Левая градиентная полоса */}
      <div className={`absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b ${long ? "from-success to-success/40" : "from-danger to-danger/40"} opacity-90`} />

      {/* Открытая часть */}
      <div className="relative p-5 pl-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <span className="font-mono text-lg font-bold tracking-tight text-white">{s.symbol}</span>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border ${
                long 
                  ? "bg-success/8 text-success border-success/20 shadow-[0_0_12px_rgba(14,203,129,0.12)]" 
                  : "bg-danger/8 text-danger border-danger/20 shadow-[0_0_12px_rgba(246,70,93,0.12)]"
              }`}>
                {long ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {s.direction}
              </span>
              <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-secondary">
                <Zap className="h-2.5 w-2.5 text-accent-cyan" />
                x{s.leverage}
              </span>
              <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">{s.margin_type}</span>
            </div>
          </div>

          {/* Статус */}
          <div className="flex flex-col items-end">
            {active ? (
              <span className="flex items-center gap-1 rounded-full bg-success/8 px-2.5 py-1 text-[9px] font-extrabold text-success border border-success/20 tracking-wider">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                АКТИВЕН
              </span>
            ) : (
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[9px] font-extrabold text-text-muted border border-white/5 tracking-wider">
                ЗАКРЫТ
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Разделитель */}
      <div className="mx-5 h-px bg-white/5" />

      {/* Закрытая (размытая) часть с ценами */}
      <div className="relative">
        <div className="select-none p-5 pl-6 blur-[5px]" aria-hidden>
          <div className="grid grid-cols-4 gap-2 rounded-xl bg-white/[0.02] border border-white/5 p-3">
            {["Вход", "Стоп", "TP1", "TP2"].map((label) => (
              <div key={label} className="text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
                <div className="mt-1 font-mono text-xs font-bold text-white">
                  {label === "Стоп" ? "000.00$" : "000.00$"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Стеклянный Оверлей авторизации */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-b-2xl"
          style={{ background: "linear-gradient(180deg, rgba(11,14,17,0.65) 0%, rgba(11,14,17,0.95) 100%)" }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-cyan/10 ring-1 ring-accent-cyan/25">
            <Lock className="h-4 w-4 text-accent-cyan" />
          </div>
          <p className="text-xs font-semibold text-white/95 tracking-wide">Войдите для просмотра цен и расчёта</p>
          <Link
            href="/login"
            className="btn bg-gradient-to-r from-accent-cyan/20 to-accent-cyan/5 hover:from-accent-cyan/30 hover:to-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 hover:border-accent-cyan/55 hover:shadow-[0_0_12px_rgba(10,255,224,0.15)] py-1.5 px-4 text-xs font-extrabold tracking-wide transition-all duration-200"
          >
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
            <div key={i} className="h-44 rounded-2xl border border-border/40 bg-bg-card">
              <div className="skeleton m-5 h-6 w-32" />
              <div className="skeleton mx-5 mt-3 h-4 w-24" />
              <div className="skeleton mx-5 mt-6 h-12 rounded-xl" />
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
