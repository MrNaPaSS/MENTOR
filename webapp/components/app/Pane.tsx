"use client";

// Разделы кабинета в оформлении рабочего стола.
//
// Терминал и кабинет были собраны разными руками и выглядели как два разных
// приложения: там плотные панели в рамке, здесь просторные карточки с крупными
// заголовками. Переход из терминала в аналитику каждый раз перестраивал глаз.
//
// Здесь общие детали, из которых собираются разделы: область с цветами
// панелей, сама панель с шапкой и ряд кнопок-чипов. Цвета берутся теми же
// переменными, что и в терминале, поэтому разделы светлеют вместе с ним.

import { useTerminalTheme } from "@/lib/terminalTheme";

/**
 * Область, внутри которой живут цвета панелей.
 *
 * Переменные `--pane-*` объявлены на классах темы, и снаружи их попросту нет:
 * панель без этой обёртки вышла бы прозрачной с невидимым текстом. Обёртка же
 * отвечает и за то, что раздел светлеет вместе с терминалом.
 */
export function PaneScope({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const theme = useTerminalTheme();
  return (
    <div className={`${theme === "light" ? "pane-light" : "pane-dark"} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Шапка раздела: название и строка о том, что здесь показано.
 *
 * В одну строку с действиями, а не тремя этажами: заголовок в два сантиметра
 * высотой ничего не сообщает тому, кто и так нажал на этот раздел, а место
 * отнимает у самих данных.
 */
export function PaneHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  /** Кнопки и переключатели раздела - справа, на той же строке. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="text-[15px] font-semibold text-[var(--pane-text)]">{title}</h1>
        {hint && <p className="truncate text-[11px] text-[var(--pane-muted)]">{hint}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-1">{children}</div>}
    </div>
  );
}

/** Панель: рамка, фон и необязательная шапка. Та же, что в терминале. */
export function Pane({
  title,
  hint,
  actions,
  children,
  className = "",
  body = "p-3",
}: {
  title?: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Поля содержимого. Пусто - когда внутри своя таблица со своими полями. */
  body?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--pane-border)] px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            {title && (
              <h2 className="truncate text-[12px] font-semibold text-[var(--pane-text)]">
                {title}
              </h2>
            )}
            {hint && (
              <span className="truncate text-[11px] text-[var(--pane-muted)]">{hint}</span>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}

/**
 * Кнопка-чип: тот же размер и та же подсветка, что у кнопок терминала.
 *
 * Строкой, а не компонентом: чипы стоят и кнопками, и ссылками, и подписями, а
 * оборачивать каждую в свой компонент значит плодить обёртки ради класса.
 */
export const CHIP =
  "rounded px-2 py-1 text-[11px] transition-[color,background-color,transform] " +
  "duration-150 ease-out active:scale-[0.97]";
export const CHIP_ON = "bg-[var(--pane-chip-faint)] text-[var(--pane-chip)]";
export const CHIP_OFF =
  "text-[var(--pane-muted)] hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]";

/** Цифра, которую читают: моноширинная, чтобы колонки не разъезжались. */
export const NUM = "font-mono tabular-nums text-[var(--pane-text)]";
