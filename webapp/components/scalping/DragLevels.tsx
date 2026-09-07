"use client";

// Линии сделки, которые тянут мышью: вход, стоп и цели.
//
// Ничего не рисуем. Линии на графике уже есть - их ставит сам график, со своими
// подписями на ценовой шкале справа, - и заводить рядом вторую разметку значит
// закрыть подписями тот самый график. Здесь только невидимая полоска поверх
// каждой линии: за неё берутся и ведут.
//
// Цена пересчитывается из координаты каждый кадр, а наружу - на биржу - уходит
// один раз, когда линию отпустили: каждый кадр перетаскивания это запрос, и
// биржа считает такое частотой запросов, а не торговлей.

import { useEffect, useRef, useState } from "react";

import type { LevelKind } from "@/lib/trade/manual";

export type DragLevel = {
  id: string;
  kind: LevelKind;
  price: number;
  /** Слово для подсказки: «вход», «стоп», «цель 2». */
  title: string;
  color: string;
  /** Тянут прямо сейчас. Вызывается часто, биржи касаться не должен. */
  onDrag: (price: number) => void;
  /** Отпустили. Только отсюда цена уходит на биржу. */
  onDrop: (price: number) => void;
  /** Чьей сделке принадлежит уровень. Пусто - это ещё не отправленная заготовка. */
  trade?: string;
  /**
   * Курсор над линией.
   *
   * У ждущей заявки разметка на графике не рисуется - она спорила бы с той
   * сделкой, которая действительно идёт. Но тянуть уровень вслепую нельзя,
   * поэтому под курсором её показывают целиком.
   */
  onHover?: (over: boolean) => void;
};

/**
 * Высота полоски захвата, экранные точки.
 *
 * Девять: в три пикселя мышью не попасть, а в двадцать попадаешь тогда, когда
 * целился в свечу.
 */
const GRAB = 9;

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

  const [held, setHeld] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const heldRef = useRef<{ id: string; price: number } | null>(null);

  // Положение - покадрово, вместе с самим графиком. Раз в четверть секунды
  // полоска отставала бы от своей линии при перетаскивании графика.
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
        node.style.transform = `translateY(${y - GRAB / 2}px)`;
      }
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [toY]);

  function grab(event: React.PointerEvent<HTMLDivElement>, level: DragLevel) {
    // График под линией не должен ни прокручиваться, ни выделяться: трейдер
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
    setOver(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
    level.onHover?.(false);
    // Отпустили ровно там, откуда взяли - на биржу ходить незачем.
    if (price !== level.price) level.onDrop(price);
  }

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-20">
      {levels.map((level) => {
        const active = over === level.id || held === level.id;
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
              "pointer-events-auto absolute left-0 right-0 " +
              (held === level.id ? "cursor-grabbing" : "cursor-ns-resize")
            }
            style={{
              height: GRAB,
              // touchAction: без него палец на телефоне прокручивает страницу
              // вместо того, чтобы вести уровень.
              touchAction: "none",
              visibility: "hidden",
              // Под курсором линия чуть светлеет: иначе о том, что её можно
              // взять, знал бы только тот, кто это написал.
              background: active
                ? `color-mix(in srgb, ${level.color} 22%, transparent)`
                : "transparent",
            }}
          />
        );
      })}
    </div>
  );
}
