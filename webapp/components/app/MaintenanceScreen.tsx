"use client";

// Заслонка на весь экран: то, что человек видит вместо сломанного места.
//
// Один вид на все поломки сразу - молчащий сервер, упавший раздел, ненайденная
// страница. Держать для каждой свой экран значит однажды показать три разных
// сайта одному человеку за одну минуту; а поломка снаружи всегда одна и та же -
// «здесь сейчас пусто, и это не ты сломал».
//
// Ролик и надпись поверх него. Ролик - потому что пустой чёрный экран читается
// как оборванная загрузка, а движение показывает, что место живое и работа
// идёт. Надпись - потому что без неё это просто картинка.
//
// Что именно случилось, экран не рассказывает: следы поломки нужны нам, а не
// тому, кто пришёл смотреть график. Разбираться с ними - забота журнала.

import type { ReactNode } from "react";

import { SOCIAL_LINKS } from "@/lib/content";

export type MaintenanceScreenProps = {
  /** Крупная строка: что произошло, словами человека, а не системы. */
  title: string;
  /** Строка помельче: что будет дальше и нужно ли что-то делать. */
  note: string;
  /** Действие внизу. Своё - там, где человек может помочь себе сам. */
  action?: ReactNode;
};

export default function MaintenanceScreen({ title, note, action }: MaintenanceScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black"
    >
      {/* Ролик фоном, во всю заслонку и в полную силу: приглушать его нечем -
          он и есть то, ради чего на этот экран смотрят дольше секунды. Звука у
          него нет и быть не должно: экран появляется сам, без нажатия, и
          заговоривший ниоткуда сайт пугает сильнее, чем молчащий. */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src="/maintenance.mp4"
        poster="/maintenance.jpg"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />

      {/* Полотна поверх ролика нет. Надпись держится на собственной тени: она
          обводит буквы, а не гасит кадр за ними, и потому читается и на тёмном
          кадре, и на светлом. */}
      <div className="relative mx-auto flex max-w-md flex-col items-center px-6 text-center [text-shadow:0_2px_18px_rgba(0,0,0,.85),0_1px_3px_rgba(0,0,0,.9)]">
        {/* Знак - тот же, что в шапке сайта и под снимками: с тем же разрывом
            цвета. Плашка с точкой на его месте выглядела служебной наклейкой,
            а здесь стоит подпись хозяина страницы. */}
        <span
          className="glitch mb-5 text-[13px] font-extrabold uppercase tracking-[0.2em] text-white"
          data-text="NMNH.TRADE"
        >
          NMNH.TRADE
        </span>

        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-white sm:text-[34px]">
          {title}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-white/85">{note}</p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {action}
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-white/25 bg-black/40 px-5 py-2.5 text-[13px] font-semibold text-white backdrop-blur-md transition-colors hover:border-white/50 hover:bg-black/55"
          >
            Мы в Telegram
          </a>
        </div>
      </div>
    </div>
  );
}

/** Кнопка-действие в том же виде, что и остальная заслонка. */
export function MaintenanceAction({
  onClick,
  href,
  children,
}: {
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}) {
  // Тень надписи кнопке не достаётся: буквы на ней чёрные, и чёрная тень под
  // ними читается как грязь на печати.
  const look =
    "rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-black transition-transform duration-150 hover:-translate-y-0.5 [text-shadow:none]";
  if (href) {
    return (
      <a href={href} className={look}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={look}>
      {children}
    </button>
  );
}
