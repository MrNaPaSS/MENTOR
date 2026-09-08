"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";

/**
 * Тон вопроса. Не цвет, а имя: сам цвет берётся в globals.css - он разный на
 * тёмной и светлой теме, и метка красит им четыре вещи с разной прозрачностью.
 */
type Tone = "cyan" | "mint" | "violet" | "amber";

interface FaqItem {
  tag: string;
  tone: Tone;
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    tag: "Академия",
    tone: "cyan",
    q: "Что такое NMNH?",
    a: "NMNH (No Money No Honey) - торговая академия с собственным терминалом, комьюнити и аналитикой. Это не канал с сигналами: терминал подключается к твоему счёту на бирже и сам ведёт открытую позицию.",
  },
  {
    tag: "Терминал",
    tone: "cyan",
    q: "Чем это отличается от обычных сигналов?",
    a: "Сигнал в канале - картинка, остальное ты делаешь руками. Здесь он открывается в терминале: объём посчитан под депозит, стоп и цели встают на биржу вместе со входом, дальше сервер сам переносит стоп в безубыток.",
  },
  {
    tag: "Безопасность",
    tone: "mint",
    q: "Безопасно ли давать API-ключи?",
    a: "Ключ создаётся только на торговлю, без права вывода - снять деньги по нему нельзя. На сервере ключи зашифрованы и в браузер не возвращаются. Отвязать можно в один клик.",
  },
  {
    tag: "Биржа",
    tone: "violet",
    q: "Работает только с WEEX?",
    a: "Да. На WEEX построены расчёт лимитов, комиссий и сопровождение сделок, и она же открывает доступ в академию.",
  },
  {
    tag: "Стоимость",
    tone: "mint",
    q: "Сколько стоит доступ?",
    a: "Абсолютно бесплатно. Достаточно зарегистрироваться на WEEX через нашу партнёрскую ссылку - и доступ открывается автоматически.",
  },
  {
    tag: "Доступ",
    tone: "cyan",
    q: "Как получить доступ?",
    a: "Зарегистрируйся на WEEX по партнёрской ссылке, введи свой WEEX UID в бот - и ты уже внутри. Никаких оплат, заявок и ожидания.",
  },
  {
    tag: "Возможности",
    tone: "violet",
    q: "Что входит в академию?",
    a: "Торговые сигналы с расчётом под твой депозит, собственный софт для анализа рынка, живое комьюнити трейдеров, разборы сделок и постоянное развитие.",
  },
  {
    tag: "Начало",
    tone: "amber",
    q: "Нужен ли опыт в трейдинге?",
    a: "Нет. Академия подходит как новичкам, так и опытным трейдерам. Каждый сигнал уже содержит все параметры - остаётся только открыть сделку.",
  },
  {
    tag: "Приложение",
    tone: "mint",
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
                className="faq-item group overflow-hidden rounded-2xl border backdrop-blur-md"
                data-tone={f.tone}
                data-open={isOpen}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex flex-col gap-2 min-w-0">
                    {/* Tag */}
                    <span className="faq-tag inline-flex w-fit items-center rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      {f.tag}
                    </span>
                    <span className="font-semibold leading-snug text-text-primary">{f.q}</span>
                  </div>

                  {/* Chevron */}
                  <span className="faq-chevron mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
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
                      <div className="faq-rule mb-4 h-px" />
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
          className="faq-cta mt-10 flex flex-col items-center gap-4 rounded-2xl border p-6 text-center sm:flex-row sm:text-left"
        >
          <div className="flex-1">
            <p className="font-bold text-text-primary">Остался вопрос?</p>
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
