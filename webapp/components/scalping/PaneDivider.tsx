"use client";

// Разделитель между панелями: тянешь — меняется ширина соседней.
//
// Ведём указатель захватом (setPointerCapture), а не слушателями на окне:
// иначе стоит увести курсор за пределы полоски — и панель отвязывается от
// пальца. Ширина меняется 1:1 с движением, без анимации и без порогов: любое
// сглаживание здесь читается как залипание.

import { useRef } from "react";

export default function PaneDivider({
  onResize,
  title,
  horizontal = false,
}: {
  /** Смещение указателя: по X у вертикального разделителя, по Y у поперечного. */
  onResize: (delta: number) => void;
  title: string;
  /** Поперечный разделитель — тянет по высоте, а не по ширине. */
  horizontal?: boolean;
}) {
  const last = useRef(0);
  const dragging = useRef(false);

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      title={title}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = horizontal ? e.clientY : e.clientX;
        dragging.current = true;
        // Пока тянем, текст выделяться не должен — иначе перетаскивание
        // превращается в выделение таблицы.
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const point = horizontal ? e.clientY : e.clientX;
        const delta = point - last.current;
        last.current = point;
        if (delta !== 0) onResize(delta);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.userSelect = "";
      }}
      onPointerCancel={() => {
        dragging.current = false;
        document.body.style.userSelect = "";
      }}
      onDoubleClick={() => onResize(Number.NaN)}   // сброс к ширине по умолчанию
      className={
        horizontal
          ? "flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center"
          : "hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center xl:flex"
      }
    >
      <span
        className={`rounded-full bg-border transition-colors duration-150 ease-out hover:bg-accent-cyan/60 ${
          horizontal ? "h-[3px] w-10" : "h-10 w-[3px]"
        }`}
      />
    </div>
  );
}
