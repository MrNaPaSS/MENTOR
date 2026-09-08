"use client";

// Чип ждущей лимитки - прямо на её линии.
//
// Стоп и цель ставятся отсюда: нажал на SL или TP и повёл, не отпуская. Так это
// сделано в торговых терминалах, где ордер выставляют с графика, и так это
// понятнее всего - обе кнопки стоят там же, где сама заявка, а не в углу
// экрана, куда надо ещё дотянуться.
//
// Чип едет за своей ценой покадрово, вместе с графиком.

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";

export type OrderChip = {
  /** Цена входа: на её линии чип и стоит. */
  price: number;
  side: "long" | "short";
  /** Объём и риск строкой - то, что не читается по самим линиям. */
  text: string;
  /** Ведут стоп: цена приходит каждый кадр, биржи не касается. */
  onDragStop: (price: number) => void;
  /** Ведут цель. */
  onDragTake: (price: number) => void;
  /** Убрать заявку целиком. */
  onCancel: () => void;
};

export default function OrderChipView({
  chip,
  toY,
  toPrice,
}: {
  chip: OrderChip;
  toY: (price: number) => number | null;
  toPrice: (y: number) => number | null;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef(chip);
  chipRef.current = chip;
  const [held, setHeld] = useState<"stop" | "take" | null>(null);

  useEffect(() => {
    let frame = 0;
    function draw() {
      frame = requestAnimationFrame(draw);
      const node = nodeRef.current;
      if (!node) return;
      const y = toY(chipRef.current.price);
      if (y === null) {
        node.style.visibility = "hidden";
        return;
      }
      node.style.visibility = "visible";
      node.style.transform = `translateY(${y - 10}px)`;
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [toY]);

  function grab(event: React.PointerEvent<HTMLButtonElement>, what: "stop" | "take") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(what);
  }

  function drag(event: React.PointerEvent<HTMLButtonElement>, what: "stop" | "take") {
    if (held !== what) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const price = toPrice(event.clientY - box.top);
    if (price === null || !(price > 0)) return;
    if (what === "stop") chipRef.current.onDragStop(price);
    else chipRef.current.onDragTake(price);
  }

  function drop(event: React.PointerEvent<HTMLButtonElement>) {
    setHeld(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const long = chip.side === "long";
  const tone = long ? "var(--pane-up)" : "var(--pane-down)";

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-30">
      <div
        ref={nodeRef}
        className="pointer-events-auto absolute left-2 top-0 flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow"
        style={{
          visibility: "hidden",
          borderColor: tone,
          background: "var(--pane-bg)",
          color: "var(--pane-text)",
        }}
      >
        <span style={{ color: tone }}>{long ? t.dialogs.manual.long : t.dialogs.manual.short}</span>
        <span className="text-[var(--pane-muted)]">{chip.text}</span>

        {/* Кнопки, которые ведут: нажал и потянул. Отдельного квадрата на своей
            цене у стопа и цели нет - их линии уже нарисованы, и хвататься можно
            прямо за них. */}
        <Handle
          label="SL"
          color="var(--pane-down)"
          active={held === "stop"}
          onPointerDown={(event) => grab(event, "stop")}
          onPointerMove={(event) => drag(event, "stop")}
          onPointerUp={drop}
          onPointerCancel={drop}
        />
        <Handle
          label="TP"
          color="var(--pane-up)"
          active={held === "take"}
          onPointerDown={(event) => grab(event, "take")}
          onPointerMove={(event) => drag(event, "take")}
          onPointerUp={drop}
          onPointerCancel={drop}
        />
        <button
          onClick={chip.onCancel}
          title={t.dialogs.manual.removeOrder}
          className="px-0.5 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Handle({
  label,
  color,
  active,
  ...events
}: {
  label: string;
  color: string;
  active: boolean;
} & Pick<
  React.ComponentProps<"button">,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>) {
  const t = useT();
  return (
    <button
      {...events}
      title={t.terminal.levels.dragChip(label)}
      className={
        "rounded-[3px] border px-1 leading-[14px] transition-colors duration-150 ease-out " +
        (active ? "cursor-grabbing" : "cursor-ns-resize")
      }
      style={{
        // touchAction: без него палец на телефоне прокручивает страницу вместо
        // того, чтобы вести уровень.
        touchAction: "none",
        borderColor: color,
        color,
        background: active ? `color-mix(in srgb, ${color} 20%, transparent)` : "transparent",
      }}
    >
      {label}
    </button>
  );
}
