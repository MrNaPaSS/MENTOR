"use client";

// Главное недоразумение про академию: «ещё один канал с сигналами».
//
// Разница объясняется не прилагательными, а тем, что человек получает: свой
// счёт на бирже, подключённый по ключам, и рабочее место, где сделка живёт от
// расчёта до записи в журнале. Поэтому секция построена как сравнение - слева
// то, что человек уже видел, справа то, чего у него не было.

import {
  AlignJustify,
  BookText,
  Check,
  KeyRound,
  LineChart,
  Lock,
  MousePointerClick,
  Radar,
  Scale,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { SOCIAL_LINKS } from "@/lib/content";

/** Чем сигнальный канал заканчивается - и с чего терминал только начинается. */
const CHANNEL_LIMITS = [
  "Скрин с уровнями - объём считай сам",
  "Пришёл ночью, увидел утром, вход упущен",
  "Стоп перенести некому: вкладка закрыта",
  "Результат «по ощущениям», статистики нет",
  "Ошибся плечом - узнал об этом из убытка",
];

const TERMINAL_GAINS = [
  "Объём, маржа и риск посчитаны под твой депозит",
  "Заявка уходит на биржу из терминала в один клик",
  "Сервер ведёт позицию, пока ты спишь",
  "Журнал считает итог по отчётам биржи, а не на глаз",
  "Плечо и лимиты монеты известны до нажатия «Войти»",
];

interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
  accent: "cyan" | "gold" | "violet" | "green";
}

const FEATURES: Feature[] = [
  {
    icon: KeyRound,
    title: "Твой счёт, твоя биржа",
    text:
      "Подключение по API-ключам за минуту. Деньги остаются на твоём счёте WEEX - мы к ним не прикасаемся, терминал только отправляет заявки.",
    accent: "cyan",
  },
  {
    icon: AlignJustify,
    title: "Стакан и лента вживую",
    text:
      "Биржевой стакан с укрупнением шага, плотности, кластеры и скринер по всему рынку. Видно, где стоит крупный, - до того, как свеча это покажет.",
    accent: "violet",
  },
  {
    icon: MousePointerClick,
    title: "Уровни тянутся мышью",
    text:
      "Вход, стоп и лестница целей - прямо на графике. Перетащил уровень - заявка на бирже переехала следом, без вкладок и ручного ввода цен.",
    accent: "gold",
  },
  {
    icon: Scale,
    title: "Риск считается за тебя",
    text:
      "Терминал знает шаг лота, тик цены, потолок плеча и комиссию монеты. Сделка уходит на биржу ровно тем расчётом, который ты видишь на экране.",
    accent: "green",
  },
  {
    icon: Radar,
    title: "Сопровождение 24/7",
    text:
      "Взята цель - стоп сам уезжает в безубыток и дальше за целями. Это делает сервер, а не вкладка: можно закрыть ноутбук и уйти по делам.",
    accent: "cyan",
  },
  {
    icon: BookText,
    title: "Журнал и статистика",
    text:
      "Каждая сделка пишется по фактическим исполнениям с биржи: результат, комиссия, взятые цели. Винрейт становится цифрой, а не самоощущением.",
    accent: "gold",
  },
];

const ACCENTS: Record<Feature["accent"], { ring: string; text: string; glow: string }> = {
  cyan: { ring: "bg-cyan-500/10 ring-cyan-500/30", text: "text-cyan-400", glow: "rgba(6,182,212,0.10)" },
  gold: { ring: "bg-amber-500/10 ring-amber-500/30", text: "text-amber-400", glow: "rgba(245,158,11,0.10)" },
  violet: { ring: "bg-purple-500/10 ring-purple-500/30", text: "text-purple-400", glow: "rgba(168,85,247,0.10)" },
  green: { ring: "bg-emerald-500/10 ring-emerald-500/30", text: "text-emerald-400", glow: "rgba(16,185,129,0.10)" },
};

/** Три вопроса про безопасность, которые задают до того, как введут ключ. */
const SAFETY = [
  {
    icon: Lock,
    title: "Ключи шифруются",
    text:
      "Уходят на сервер один раз и обратно не возвращаются - в браузере остаётся только хвост из четырёх символов.",
  },
  {
    icon: ShieldCheck,
    title: "Без права вывода",
    text:
      "Ключ создаётся только на торговлю. Вывести средства с твоего счёта по нему невозможно - такого права у него нет.",
  },
  {
    icon: X,
    title: "Отключение в один клик",
    text:
      "Кнопка «Отвязать» в терминале стирает ключи с сервера. Или отзови их на стороне биржи - в любой момент.",
  },
];

export default function Terminal() {
  return (
    <section id="terminal" className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 h-72 bg-radial-cyan opacity-40" />

      <SectionHeading
        eyebrow="Терминал академии"
        title={
          <>
            Это не сигналы.{" "}
            <span className="text-accent-cyan text-glow-cyan">Это твоё рабочее место.</span>
          </>
        }
        subtitle="NMNH - торговый терминал, который подключается к твоему счёту на бирже по API. Расчёт, стакан, график, заявка и журнал в одном окне. Сигналы - лишь одна из кнопок внутри."
      />

      {/* Сравнение: канал против терминала */}
      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-text-muted ring-1 ring-white/10">
                <X className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                  Как у всех
                </div>
                <div className="font-bold text-text-secondary">Канал с сигналами</div>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {CHANNEL_LIMITS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-text-muted">
                  <X className="mt-0.5 h-4 w-4 shrink-0 opacity-50" />
                  <span className="line-through decoration-white/15">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div
            className="relative h-full overflow-hidden rounded-2xl border p-6"
            style={{
              borderColor: "rgba(6,182,212,0.28)",
              background:
                "radial-gradient(ellipse at top right, rgba(6,182,212,0.10) 0%, transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
            }}
          >
            <span className="badge-cyan absolute right-5 top-5">
              <Sparkles className="h-3 w-3" /> Бесплатно
            </span>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/30">
                <LineChart className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent-cyan">
                  Как у нас
                </div>
                <div className="font-bold text-text-primary">Терминал NMNH</div>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {TERMINAL_GAINS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-text-primary">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      {/* Возможности терминала */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => {
          const a = ACCENTS[f.accent];
          const Icon = f.icon;
          return (
            <Reveal as="article" key={f.title} delay={(i % 3) * 0.1}>
              <div
                className="group h-full rounded-2xl border border-white/[0.07] p-5 transition-all duration-500 hover:-translate-y-1.5 hover:border-white/15"
                style={{
                  background: `radial-gradient(ellipse at top left, ${a.glow} 0%, transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)`,
                }}
              >
                <span
                  className={`grid h-11 w-11 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 ${a.ring} ${a.text}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-bold text-text-primary">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{f.text}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* Безопасность: три возражения, которые снимаются до ввода ключа */}
      <Reveal delay={0.1}>
        <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-3">
          {SAFETY.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="bg-bg-deep/80 p-5">
                <div className="flex items-center gap-2 text-accent-cyan">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-bold text-text-primary">{s.title}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-text-muted">{s.text}</p>
              </div>
            );
          })}
        </div>
      </Reveal>

      {/* CTA */}
      <Reveal delay={0.2}>
        <div
          className="mt-4 flex flex-col items-center gap-5 rounded-2xl border p-7 text-center md:flex-row md:justify-between md:text-left"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(168,85,247,0.06) 100%)",
            borderColor: "rgba(6,182,212,0.22)",
          }}
        >
          <div>
            <p className="text-xl font-black text-text-primary">Доступ к терминалу - бесплатно</p>
            <p className="mt-1.5 max-w-xl text-sm text-text-secondary">
              Регистрация на WEEX по партнёрской ссылке открывает всю академию: терминал, сигналы,
              аналитику и комьюнити. Подписок и оплат нет.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-3">
            <Link href="/login" className="btn-primary">
              Открыть терминал
            </Link>
            <a
              href={SOCIAL_LINKS.weexAffiliate}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline"
            >
              Счёт на WEEX
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
