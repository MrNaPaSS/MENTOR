"use client";

// Строка веток разговора: те же, что темы в форуме.
//
// Строкой, а не списком в меню: ветка это не настройка, а место, где сейчас
// идёт разговор, и прятать её за нажатием значит прятать сам разговор.
//
// Отдельным файлом, потому что тут не разметка, а поведение: строка шире
// панели, и её надо уметь листать. Мышью это не само собой - колесо крутит
// страницу, а не строку, и четвёртая вкладка за краем оставалась ненайденной.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { ChatThread } from "@/lib/chat/store";

/** Насколько уезжает строка от одного нажатия на стрелку, точки. */
const STEP = 120;

export type ThreadTabsSkin = {
  /** Кнопка открытой ветки. */
  on: string;
  /** Кнопка остальных веток. */
  off: string;
  /** Приглушённый текст: им написаны неоткрытые ветки. */
  muted: string;
  /** Метка непрочитанного на вкладке. */
  badge: string;
  /** Стрелка листания. */
  arrow: string;
};

export default function ThreadTabs({
  threads,
  current,
  unread,
  onPick,
  skin,
  hint,
  unreadTitle,
}: {
  threads: ChatThread[];
  current: number;
  /** Сколько непрочитанного в каждой ветке. */
  unread: Record<number, number>;
  onPick: (thread: number) => void;
  skin: ThreadTabsSkin;
  /** Подсказка на ветке, которая живёт в форуме. */
  hint: string;
  unreadTitle: (n: number) => string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);

  // Есть ли что листать и в какую сторону. Считается по самой строке, а не по
  // числу веток: ширина вкладок зависит от их названий и от ширины панели,
  // которую трейдер тянет мышью.
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setLeft(row.scrollLeft > 1);
    setRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }, []);

  useEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [measure, threads]);

  // Колесо мыши листает строку вбок.
  //
  // Само по себе оно этого не делает: браузер отдаёт вертикальную прокрутку
  // странице, и строка стояла на месте, сколько её ни крути. Слушателем на
  // элементе, а не свойством React: React вешает колесо пассивным, а пассивный
  // слушатель не имеет права отменить прокрутку страницы.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const onWheel = (event: WheelEvent) => {
      // Строка уже у края в ту же сторону - отдаём прокрутку странице: иначе
      // она встанет колом под курсором.
      const step = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (step === 0) return;
      const at = row.scrollLeft;
      const edge = row.scrollWidth - row.clientWidth;
      if ((step < 0 && at <= 0) || (step > 0 && at >= edge)) return;
      event.preventDefault();
      row.scrollLeft = at + step;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);

  function slide(to: 1 | -1) {
    rowRef.current?.scrollBy({ left: to * STEP, behavior: "smooth" });
  }

  return (
    <div className="relative flex items-center">
      {left && (
        <button
          onClick={() => slide(-1)}
          className={`absolute left-0 z-10 grid h-6 w-6 place-items-center rounded-full ${skin.arrow}`}
          aria-label="◀"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Полосу прокрутки прячем. Windows рисует её всегда, а не на время
          движения, и под строкой из четырёх кнопок она читается как отдельный
          элемент интерфейса, который зачем-то нужно тянуть. */}
      <div
        ref={rowRef}
        onScroll={measure}
        className="no-scrollbar flex flex-1 gap-1 overflow-x-auto px-2 py-1.5"
      >
        {threads.map((branch) => {
          const count = unread[branch.id] ?? 0;
          return (
            <button
              key={branch.id}
              onClick={() => onPick(branch.id)}
              title={branch.forum ? hint : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors duration-150 ease-out ${
                branch.id === current ? skin.on : `${skin.muted} ${skin.off}`
              }`}
            >
              <span>
                {branch.title}
                {branch.closed && " ·"}
              </span>
              {/* Метка непрочитанного - числом, а не точкой: три сообщения и
                  тридцать зовут вернуться по-разному. */}
              {count > 0 && (
                <span
                  title={unreadTitle(count)}
                  className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold leading-none ${skin.badge}`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {right && (
        <button
          onClick={() => slide(1)}
          className={`absolute right-0 z-10 grid h-6 w-6 place-items-center rounded-full ${skin.arrow}`}
          aria-label="▶"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
