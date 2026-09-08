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
      {/* Ролик фоном, во всю заслонку. Звука у него нет и быть не должно:
          экран появляется сам, без нажатия, и заговоривший ниоткуда сайт
          пугает сильнее, чем молчащий. */}
      <video
        className="absolute inset-0 h-full w-full object-cover opacity-70"
        src="/maintenance.mp4"
        poster="/maintenance.jpg"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />

      {/* Затемнение под надписью: ролик тёмный, но не везде, и белый текст на
          светлом кадре пропадает ровно в тот момент, когда его читают. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-black/85" />

      <div className="relative mx-auto flex max-w-md flex-col items-center px-6 text-center">
        <span className="mb-5 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          NMNH.TRADE
        </span>

        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-white sm:text-[34px]">
          {title}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-white/70">{note}</p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {action}
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-white/20 px-5 py-2.5 text-[13px] font-semibold text-white/80 transition-colors hover:border-white/40 hover:text-white"
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
  const look =
    "rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-black transition-transform duration-150 hover:-translate-y-0.5";
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
