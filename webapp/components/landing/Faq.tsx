"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";

interface FaqItem {
  tag: string;
  tagColor: string;
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    tag: "Платформа",
    tagColor: "#06B6D4",
    q: "Что такое NMNH и как это работает?",
    a: "NMNH (No Money No Honey) — это торговый ментор-платформа. Аналитик выдаёт сигналы: пара, направление LONG/SHORT, плечо, зоны входа и тейк-профиты. Бот автоматически рассчитывает точный объём, маржу и стоп под твой депозит. Ты открываешь сделку на WEEX с готовыми параметрами — без гадания, без ошибок на расчёте.",
  },
  {
    tag: "Результаты",
    tagColor: "#00D4A0",
    q: "Какой реальный винрейт у сигналов?",
    a: "71–74% за последние 12 месяцев. Все сделки верифицируются в разделе «Аналитика» кабинета — ты видишь каждую позицию с датой, ценой входа и результатом. Только цифры, никаких cherry-picked скриншотов.",
  },
  {
    tag: "Режимы",
    tagColor: "#A855F7",
    q: "Чем умеренный режим отличается от турбо?",
    a: "Умеренный: плечо до 25×, риск 1–3% на сделку — для стабильного роста, сделки не выбивает на флуктуациях. Турбо: плечо до 400×, риск до 10% — для опытных трейдеров с психологической устойчивостью. Режим переключается в один клик в профиле, без ограничений.",
  },
  {
    tag: "Расчёт",
    tagColor: "#F59E0B",
    q: "Как именно калькулятор считает позицию?",
    a: "Формула: Объём = Депозит × % риска ÷ (Цена входа − Цена стопа). Маржа = Объём × Цена ÷ Плечо. Каждый тейк-профит рассчитывается по RR 1:2, 1:3, 1:5 — ты видишь ровно сколько заработаешь на каждом уровне и сколько потеряешь при срабатывании стопа, ещё до открытия сделки.",
  },
  {
    tag: "Доступ",
    tagColor: "#06B6D4",
    q: "Что нужно сделать для получения доступа?",
    a: "Три шага: 1) Зарегистрируйся на WEEX по партнёрской ссылке. 2) Пополни депозит — рекомендуем от $300. 3) Введи WEEX UID в бот @nmnh_bot. Доступ открывается автоматически, никакой ручной верификации. Весь процесс занимает 10–15 минут.",
  },
  {
    tag: "Стоимость",
    tagColor: "#00D4A0",
    q: "Сколько стоит доступ к сигналам?",
    a: "Доступ бесплатный. Платформа зарабатывает на партнёрской комиссии WEEX с твоих торговых объёмов — эта комиссия уже включена в стандартный спред биржи, ты ничего не платишь сверху. Чем лучше ты торгуешь, тем лучше для всех.",
  },
  {
    tag: "Депозит",
    tagColor: "#F59E0B",
    q: "Какой минимальный депозит для старта?",
    a: "Технически от $100, но при таком депозите калькулятор выдаёт микро-позиции из-за лимитов минимального объёма WEEX. Оптимальный старт — от $300 на умеренном режиме, от $500 на турбо. Это обеспечивает корректный расчёт RR и нормальные стопы.",
  },
  {
    tag: "Риски",
    tagColor: "#FF4757",
    q: "Что будет, если сигнал закроется по стопу?",
    a: "Каждый сигнал содержит стоп-лосс. При риске 2% на сделку убыток — $20 на депозит $1000. При винрейте 72% и RR 1:2 серия из 10 сделок даёт +44% к депозиту даже с учётом убытков. Риск управляем — это математика, а не удача.",
  },
  {
    tag: "Торговля",
    tagColor: "#A855F7",
    q: "Можно ли торговать несколько пар одновременно?",
    a: "Да. Сигналы приходят по разным инструментам: BTC, ETH, SOL, XRP, BNB и другим. Калькулятор считает каждую позицию отдельно. Рекомендация — не держать больше 3–5 открытых сделок одновременно, чтобы не перегружать маржу и сохранять контроль.",
  },
  {
    tag: "Доступ",
    tagColor: "#06B6D4",
    q: "Есть ли мобильное приложение?",
    a: "Веб-приложение полностью адаптировано под мобильные устройства. Зайди на nmnh.app с телефона — получишь полноценный торговый терминал с графиками, стаканом цен, сигналами и калькулятором позиции. Telegram-бот работает на любом устройстве 24/7.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="FAQ"
        title="Частые вопросы"
        subtitle="Всё что нужно знать перед стартом — честно и без воды."
      />

      <div className="mt-12 space-y-2.5">
        {FAQS.map((f, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={i} delay={i * 0.04}>
              <div
                className="group overflow-hidden rounded-2xl border backdrop-blur-md transition-all duration-300"
                style={{
                  borderColor: isOpen ? f.tagColor + "60" : "rgba(255,255,255,0.10)",
                  background: isOpen ? "rgba(20,22,42,0.75)" : "rgba(15,16,32,0.55)",
                  boxShadow: isOpen ? `0 0 0 1px ${f.tagColor}20` : "none",
                }}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex flex-col gap-2 min-w-0">
                    {/* Tag */}
                    <span
                      className="inline-flex w-fit items-center rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        color: f.tagColor,
                        background: f.tagColor + "18",
                        border: `1px solid ${f.tagColor}30`,
                      }}
                    >
                      {f.tag}
                    </span>
                    <span className="font-semibold leading-snug text-white">{f.q}</span>
                  </div>

                  {/* Chevron */}
                  <span
                    className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-300"
                    style={{
                      background: isOpen ? f.tagColor + "20" : "rgba(255,255,255,0.05)",
                      color: isOpen ? f.tagColor : "rgba(255,255,255,0.4)",
                    }}
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {/* Answer */}
                <div
                  className="grid transition-all duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="px-5 pb-5">
                      {/* Separator */}
                      <div
                        className="mb-4 h-px"
                        style={{ background: `linear-gradient(90deg, ${f.tagColor}40, transparent)` }}
                      />
                      <p className="text-sm leading-relaxed text-text-secondary">{f.a}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* CTA */}
      <Reveal delay={0.5}>
        <div
          className="mt-10 flex flex-col items-center gap-4 rounded-2xl border p-6 text-center sm:flex-row sm:text-left"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.06) 0%, rgba(168,85,247,0.06) 100%)",
            borderColor: "rgba(6,182,212,0.20)",
          }}
        >
          <div className="flex-1">
            <p className="font-bold text-white">Остался вопрос?</p>
            <p className="mt-1 text-sm text-text-secondary">
              Напишите в Telegram — отвечаем в течение нескольких часов.
            </p>
          </div>
          <a
            href="https://t.me/nmnh"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-xl bg-accent-cyan px-5 py-2.5 text-sm font-bold text-bg-deep transition hover:brightness-110"
          >
            Написать в Telegram →
          </a>
        </div>
      </Reveal>
    </section>
  );
}
