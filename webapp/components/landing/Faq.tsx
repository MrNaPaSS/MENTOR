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
    tag: "Академия",
    tagColor: "#06B6D4",
    q: "Что такое NMNH?",
    a: "NMNH (No Money No Honey) - торговая академия с огромным живым комьюнити, собственными инструментами и аналитикой. Это не просто сигналы - это среда, в которой растут трейдеры.",
  },
  {
    tag: "Стоимость",
    tagColor: "#00D4A0",
    q: "Сколько стоит доступ?",
    a: "Абсолютно бесплатно. Достаточно зарегистрироваться на WEEX через нашу партнёрскую ссылку - и доступ открывается автоматически.",
  },
  {
    tag: "Доступ",
    tagColor: "#06B6D4",
    q: "Как получить доступ?",
    a: "Зарегистрируйся на WEEX по партнёрской ссылке, введи свой WEEX UID в бот - и ты уже внутри. Никаких оплат, заявок и ожидания.",
  },
  {
    tag: "Возможности",
    tagColor: "#A855F7",
    q: "Что входит в академию?",
    a: "Торговые сигналы с расчётом под твой депозит, собственный софт для анализа рынка, живое комьюнити трейдеров, разборы сделок и постоянное развитие.",
  },
  {
    tag: "Начало",
    tagColor: "#F59E0B",
    q: "Нужен ли опыт в трейдинге?",
    a: "Нет. Академия подходит как новичкам, так и опытным трейдерам. Каждый сигнал уже содержит все параметры - остаётся только открыть сделку.",
  },
  {
    tag: "Приложение",
    tagColor: "#00D4A0",
    q: "Есть ли мобильное приложение?",
    a: "Да - WebApp работает прямо в Telegram и полностью адаптирован под мобильные устройства. Открывай сделки, смотри сигналы и аналитику в один тап.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="FAQ"
        title="Частые вопросы"
        subtitle="Всё что нужно знать перед стартом - честно и без воды."
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
              Напишите в Telegram - отвечаем в течение нескольких часов.
            </p>
          </div>
          <a
            href="https://t.me/+81HEkQveJic2YmEy"
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
