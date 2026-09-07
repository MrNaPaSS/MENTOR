"use client";

// Уровни, которые тянут мышью: вход, стоп и цель.
//
// Квадрат стоит на своей цене и едет за курсором, пока его держат. Цена
// пересчитывается из координаты каждый кадр, а наружу - на биржу - уходит один
// раз, когда квадрат отпустили: каждый кадр перетаскивания это запрос, и биржа
// считает такое частотой запросов, а не торговлей.
//
// Компонент ничего не знает ни о сделках, ни о бирже: ему дают цену, цвет и два
// обработчика. Вся торговая логика остаётся на странице, а здесь только
// геометрия - иначе она осела бы в графике, который и без того велик.

import { useEffect, useRef, useState } from "react";

import type { LevelKind } from "@/lib/trade/manual";

export type DragLevel = {
  id: string;
  kind: LevelKind;
  price: number;
  /** Слово у квадрата: «вход», «стоп», «цель». */
  title: string;
  /** Деньги или расстояние - то, что помогает решить, куда тянуть. */
  note?: string;
  color: string;
  /** Тянут прямо сейчас. Вызывается часто, биржи касаться не должен. */
  onDrag: (price: number) => void;
  /** Отпустили. Только отсюда цена уходит на биржу. */
  onDrop: (price: number) => void;
  /** Чьей сделке принадлежит уровень. Пусто - это ещё не отправленная заготовка. */
  trade?: string;
  /**
   * Курсор над уровнем.
   *
   * У ждущей заявки разметка на графике не рисуется - она спорила бы с той
   * сделкой, которая действительно идёт. Но тянуть уровень вслепую нельзя,
   * поэтому под курсором её показывают целиком.
   */
  onHover?: (over: boolean) => void;
};

export default function DragLevels({
  levels,
  toY,
  toPrice,
  format,
}: {
  levels: DragLevel[];
  /** Координата цены на холсте. `null` - цена вне видимой шкалы. */
  toY: (price: number) => number | null;
  /** Цена по координате. `null` - график ещё не готов отвечать. */
  toPrice: (y: number) => number | null;
  format: (price: number) => string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement | null>());
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  // Что тянут сейчас и куда дотянули. В ref, а не в состоянии: положение
  // пишется каждый кадр, и перерисовывать ради него React незачем.
  const [held, setHeld] = useState<string | null>(null);
  // Под курсором. Подпись разворачивается только здесь: десяток названий с
  // ценами закрывал сам график - ровно то, ради чего его и открыли.
  const [over, setOver] = useState<string | null>(null);
  const heldRef = useRef<{ id: string; price: number } | null>(null);

  // Положение - покадрово, вместе с самим графиком. Раз в четверть секунды
  // квадрат отставал бы от своей линии при перетаскивании графика.
  useEffect(() => {
    let frame = 0;
    function draw() {
      frame = requestAnimationFrame(draw);
      for (const level of levelsRef.current) {
        const node = nodesRef.current.get(level.id);
        if (!node) continue;
        const y = toY(level.price);
        if (y === null) {
          node.style.visibility = "hidden";
          continue;
        }
        node.style.visibility = "visible";
        node.style.transform = `translateY(${y - 11}px)`;
      }
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [toY]);

  function grab(event: React.PointerEvent<HTMLDivElement>, level: DragLevel) {
    // График под квадратом не должен ни прокручиваться, ни выделяться: трейдер
    // тянет уровень, а не полотно.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    heldRef.current = { id: level.id, price: level.price };
    setHeld(level.id);
  }

  function drag(event: React.PointerEvent<HTMLDivElement>, level: DragLevel) {
    if (heldRef.current?.id !== level.id) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const price = toPrice(event.clientY - box.top);
    if (price === null || !(price > 0)) return;
    heldRef.current = { id: level.id, price };
    level.onDrag(price);
  }

  function drop(event: React.PointerEvent<HTMLDivElement>, level: DragLevel) {
    if (heldRef.current?.id !== level.id) return;
    const price = heldRef.current.price;
    heldRef.current = null;
    setHeld(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
    setOver(null);
    level.onHover?.(false);
    // Отпустили ровно там, откуда взяли - на биржу ходить незачем.
    if (price !== level.price) level.onDrop(price);
  }

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-20">
      {levels.map((level) => {
        // Развёрнута подпись или один квадрат: разворачиваем под курсором и
        // пока уровень держат - в остальное время он не должен закрывать свечи.
        const open = over === level.id || held === level.id;
        return (
        <div
          key={level.id}
          ref={(node) => {
            nodesRef.current.set(level.id, node);
          }}
          onPointerEnter={() => {
            setOver(level.id);
            level.onHover?.(true);
          }}
          onPointerLeave={() => {
            if (heldRef.current?.id === level.id) return;
            setOver(null);
            level.onHover?.(false);
          }}
          onPointerDown={(event) => grab(event, level)}
          onPointerMove={(event) => drag(event, level)}
          onPointerUp={(event) => drop(event, level)}
          onPointerCancel={(event) => drop(event, level)}
          title={`${level.title} ${format(level.price)} - потяните, чтобы перенести`}
          className={
            "pointer-events-auto absolute left-1 top-0 flex select-none items-center " +
            "rounded-[3px] border font-mono text-[10px] tabular-nums " +
            (open ? "gap-1.5 px-1.5 py-0.5 shadow" : "p-[3px]") +
            (held === level.id ? " cursor-grabbing" : " cursor-ns-resize")
          }
          style={{
            // touchAction: без него палец на телефоне прокручивает страницу
            // вместо того, чтобы вести уровень.
            touchAction: "none",
            visibility: "hidden",
            borderColor: level.color,
            background: open ? "var(--pane-bg)" : "transparent",
            color: level.color,
            // Взятый уровень поднимаем над остальными: под курсором должен быть
            // он, а не сосед, мимо которого его проносят.
            zIndex: held === level.id ? 2 : 1,
          }}
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-[1px]"
            style={{ background: level.color }}
          />
          {open && (
            <>
              <span className="uppercase">{level.title}</span>
              <span className="text-[var(--pane-text)]">{format(level.price)}</span>
              {level.note ? (
                <span className="text-[var(--pane-muted)]">{level.note}</span>
              ) : null}
            </>
          )}
        </div>
        );
      })}
    </div>
  );
}
