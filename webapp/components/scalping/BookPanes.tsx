"use client";

// Три кусочка терминала, которые живут на кадре стакана.
//
// Кадр приходит восемь раз в секунду. Стакану, графику и строке с ценой это
// необходимо - за тем на них и смотрят. Остальному терминалу - нет, и пока
// кадр лежал в состоянии страницы, он тащил за собой всё: журнал, чат,
// диалоги, разметку на четыре тысячи строк.
//
// Поэтому кадр берётся здесь, у самого места, где он нужен. Страница его не
// видит и на нём не перерисовывается, а эти трое - перерисовываются и должны.

import type { ComponentProps, ReactNode } from "react";

import { useDomFrame, useLivePrice } from "@/lib/domFeed";
import { price as fmtPrice } from "@/lib/scalping";
import DomTrader from "./DomTrader";
import PriceChart from "./PriceChart";

type DomProps = ComponentProps<typeof DomTrader>;
type ChartProps = ComponentProps<typeof PriceChart>;

/** Стакан. Кадра нет - показываем, что книга ещё собирается. */
export function BookLadder({
  waiting,
  ...rest
}: Omit<DomProps, "frame"> & {
  /** Что показать, пока кадра нет. */
  waiting: ReactNode;
}) {
  const frame = useDomFrame();
  if (!frame) {
    return (
      <p className="grid h-full place-items-center text-sm text-[var(--pane-muted)]">
        {waiting}
      </p>
    );
  }
  return <DomTrader frame={frame} {...rest} />;
}

/**
 * График с тем, что едет кадром: плита, полки, живая свеча и её профиль.
 *
 * Шаг сетки лестницы делим на укрупнение: биржевой шаг от него не зависит, а
 * точность шкалы должна быть по бирже.
 */
export function BookChart({
  agg,
  ...rest
}: Omit<
  ChartProps,
  "venue" | "wall" | "shelves" | "liveCandle" | "liveFoot" | "tick" | "livePrice"
> & {
  /** Во сколько раз укрупнён шаг лестницы. */
  agg: number;
}) {
  const frame = useDomFrame();
  const livePrice = useLivePrice();
  return (
    <PriceChart
      {...rest}
      livePrice={livePrice}
      // Биржа свечей - только когда книга не с общей биржи. Пустая строка и
      // "binance" - один и тот же источник, но разные адреса запроса: пока
      // первый кадр стакана не пришёл, график успевал сходить за свечами без
      // биржи, а следом второй раз - с ней. Лишний поход стоит веса запросов,
      // которого не хватает снимкам стаканов.
      venue={frame?.exchange && frame.exchange !== "binance" ? frame.exchange : ""}
      wall={frame?.wall ?? null}
      shelves={frame?.shelves ?? []}
      liveCandle={frame?.candle ?? null}
      liveFoot={frame?.foot ?? null}
      tick={frame && frame.tick > 0 ? frame.tick / Math.max(1, agg) : undefined}
    />
  );
}

/** Цена середины книги - строкой в шапке графика. */
export function BookMid() {
  const frame = useDomFrame();
  return <>{frame ? fmtPrice(frame.mid, frame.tick) : "-"}</>;
}

/** Плита книги: сумма, цена и с какой она стороны. */
export function BookWall({
  render,
}: {
  /** Как показать плиту. Пусто - плиты в книге сейчас нет. */
  render: (wall: { notional: number; price: number; side: "bid" | "ask" }, tick: number) => ReactNode;
}) {
  const frame = useDomFrame();
  if (!frame?.wall) return null;
  return <>{render(frame.wall, frame.tick)}</>;
}
