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
}: {
  onResize: (deltaX: number) => void;
  title: string;
}) {
  const lastX = useRef(0);
  const dragging = useRef(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        lastX.current = e.clientX;
        dragging.current = true;
        // Пока тянем, текст выделяться не должен — иначе перетаскивание
        // превращается в выделение таблицы.
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const delta = e.clientX - lastX.current;
        lastX.current = e.clientX;
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
      className="hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center xl:flex"
    >
      <span className="h-10 w-[3px] rounded-full bg-border transition-colors duration-150 ease-out hover:bg-accent-cyan/60" />
    </div>
  );
}
