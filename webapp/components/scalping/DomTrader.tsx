"use client";

// DOM Trader: единая ценовая шкала, слева история прошедших объёмов по
// интервалам, справа живой стакан.
//
// Смысл раскладки в том, что обе половины читаются по одной строке. Стакан
// показывает намерения — заявки, которые стоят сейчас и могут исчезнуть.
// Кластеры слева показывают факт: где сделки уже проходили и в какую сторону.
// Плита в стакане стоит внимания ровно настолько, насколько цена отбивалась от
// этого уровня раньше, и увидеть это можно только когда они на одной линии.
//
// Строки не переставляются при обновлении: высота фиксирована, ключ — цена.
// Меняются только числа. Иначе на восьми кадрах в секунду таблица дрожала бы.

import { memo, useEffect, useMemo, useRef } from "react";
import {
  clockLabel,
  money,
  price as fmtPrice,
  type ClusterColumn,
  type DomFrame,
  type LadderRow,
} from "@/lib/scalping";

const ROW_HEIGHT = 21;

// Ширина колонки истории. Фиксированная, а не доля свободного места: пока
// история не набралась, пустые колонки растягивались на всю ширину экрана и
// оставляли стакану полоску у правого края.
// Ширины взяты из рабочего пространства заказчика (Tiger.Trade):
// ClusterWidth=111 для профиля bid/ask, DomWidth=177 на колонку стакана.
// Четыре колонки истории плюс стакан дают ровно ширину панели.
const COL_W = "w-[111px]";
const BOOK_W = "w-[177px]";
const MAX_VISIBLE_COLUMNS = 4;

/** Ячейки истории приходят тройками — раскладываем в карту по цене строки. */
function indexCells(columns: ClusterColumn[]): Map<number, [number, number]>[] {
  return columns.map((column) => {
    const map = new Map<number, [number, number]>();
    for (const [price, buy, sell] of column.cells) map.set(price, [buy, sell]);
    return map;
  });
}

export default function DomTrader({ frame }: { frame: DomFrame }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);

  const askCount = useMemo(() => frame.rows.filter((r) => r.ask > 0).length, [frame.rows]);

  // Показываем только заполненные колонки истории, и не больше шести.
  // Пустые занимали по 54 пикселя каждая: пока история набиралась, стакан
  // ужимался в полоску, а слева стояло полтысячи пикселей пустоты.
  const columns = useMemo(
    () => frame.clusters.filter((c) => c.cells.length > 0).slice(-MAX_VISIBLE_COLUMNS),
    [frame.clusters],
  );
  const cells = useMemo(() => indexCells(columns), [columns]);

  // Масштаб полос — по самой крупной строке стакана в окне. Считаем по всему
  // окну, иначе при каждом обновлении полосы «дышали» бы.
  const bookScale = useMemo(
    () => Math.max(1, ...frame.rows.map((r) => r.notional)),
    [frame.rows],
  );
  // История масштабируется своей величиной: объёмы за пять минут и объём
  // стоящей заявки — величины разного порядка, общий масштаб убил бы одну из них.
  const clusterScale = useMemo(() => {
    let max = 1;
    for (const map of cells) {
      for (const [buy, sell] of map.values()) max = Math.max(max, buy, sell);
    }
    return max;
  }, [cells]);

  useEffect(() => {
    centered.current = false;
  }, [frame.symbol]);

  // Один раз ставим спред в середину экрана. Дальше прокрутку не трогаем:
  // трейдер мог увести взгляд на дальнюю плиту, и рывок сбил бы его.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || centered.current || frame.rows.length === 0) return;
    el.scrollTop = Math.max(0, askCount * ROW_HEIGHT - el.clientHeight / 2);
    centered.current = true;
  }, [askCount, frame.rows.length]);

  return (
    <div className="flex h-full flex-col text-[11px] tabular-nums">
      <Header frame={frame} />

      <div className="flex border-b border-border bg-bg-deep/60 text-text-muted">
        {columns.map((column) => (
          <div key={column.start} className={`${COL_W} py-1 text-center`}>
            {clockLabel(column.start)}
          </div>
        ))}
        <div className={`${BOOK_W} py-1 pr-2 text-right`}>объём · цена</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono">
        {frame.rows.map((row, index) => {
          const items = [];
          if (index === askCount && askCount > 0) {
            items.push(
              <SpreadRow key="spread" frame={frame} />,
            );
          }
          items.push(
            <Row
              key={row.price}
              row={row}
              tick={frame.tick}
              cells={cells}
              bookScale={bookScale}
              clusterScale={clusterScale}
            />,
          );
          return items;
        })}
      </div>

      <Totals columns={columns} />
    </div>
  );
}

/** Шапка: цена, спред, перевес и самая крупная заявка рядом. */
function Header({ frame }: { frame: DomFrame }) {
  const spreadBp =
    frame.mid > 0 ? ((frame.best_ask - frame.best_bid) / frame.mid) * 10_000 : 0;
  const buy = Math.round(frame.book_ratio * 100);

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-semibold text-text-primary">
          {fmtPrice(frame.mid, frame.tick)}
        </span>
        <span className="text-[11px] text-text-muted">спред {spreadBp.toFixed(1)} б.п.</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="w-7 text-right font-mono text-[10px] text-danger">{100 - buy}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-sm bg-bg-deep">
          <div className="bg-success/70" style={{ width: `${buy}%` }} />
          <div className="bg-danger/70" style={{ width: `${100 - buy}%` }} />
        </div>
        <span className="w-7 font-mono text-[10px] text-success">{buy}</span>
      </div>

      {frame.wall && (
        <p className="mt-2 text-[11px] text-accent-gold">
          Плита {money(frame.wall.notional)} на {fmtPrice(frame.wall.price, frame.tick)} —{" "}
          {frame.wall.side === "bid" ? "поддержка" : "сопротивление"} в{" "}
          {frame.wall.distance_bp.toFixed(1)} б.п.
        </p>
      )}
    </div>
  );
}

function SpreadRow({ frame }: { frame: DomFrame }) {
  return (
    <div
      className="flex items-center border-y border-accent-cyan/30 bg-accent-cyan/5 text-accent-cyan"
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex-1" />
      <div className={`${BOOK_W} flex items-center justify-between px-2`}>
        <span>{fmtPrice(frame.best_bid, frame.tick)}</span>
        <span>{fmtPrice(frame.best_ask, frame.tick)}</span>
      </div>
    </div>
  );
}

const Row = memo(function Row({
  row,
  tick,
  cells,
  bookScale,
  clusterScale,
}: {
  row: LadderRow;
  tick: number;
  cells: Map<number, [number, number]>[];
  bookScale: number;
  clusterScale: number;
}) {
  const isBid = row.bid > 0;
  const width = Math.min(100, (row.notional / bookScale) * 100);

  return (
    <div
      className={`flex items-center ${isBid ? "bg-success/[0.04]" : "bg-danger/[0.04]"}`}
      style={{ height: ROW_HEIGHT }}
    >
      {cells.map((map, i) => {
        const cell = map.get(row.price);
        return <ClusterCell key={i} cell={cell} scale={clusterScale} />;
      })}

      {/* Гистограмма внутри строки, процентами от максимума в окне: так
          настроен стакан заказчика (DomRuler=Percents, position=inside). */}
      <div className={`relative ${BOOK_W} flex items-center justify-between px-2`}>
        <div
          className={`absolute inset-y-[2px] left-0 ${
            row.is_wall
              ? "bg-accent-gold/35"
              : row.strong
                ? isBid
                  ? "bg-success/40"
                  : "bg-danger/40"
                : isBid
                  ? "bg-success/20"
                  : "bg-danger/20"
          }`}
          style={{ width: `${width}%` }}
        />
        <span
          className={`relative z-10 ${
            row.is_wall
              ? "font-semibold text-accent-gold"
              : row.strong
                ? "font-semibold text-text-primary"
                : isBid
                  ? "text-success"
                  : "text-danger"
          }`}
        >
          {money(row.notional)}
        </span>
        <span className="relative z-10 text-text-secondary">{fmtPrice(row.price, tick)}</span>
      </div>
    </div>
  );
});

/** Ячейка истории: слева продажи, справа покупки — как в референсе. */
function ClusterCell({
  cell,
  scale,
}: {
  cell: [number, number] | undefined;
  scale: number;
}) {
  if (!cell) return <div className={COL_W} />;
  const [buy, sell] = cell;
  return (
    <div className={`flex ${COL_W} items-center justify-end gap-0.5 px-1`}>
      <span
        className="text-right text-danger/90"
        style={{ opacity: sell > 0 ? 0.45 + 0.55 * (sell / scale) : 0.25 }}
      >
        {sell > 0 ? money(sell) : ""}
      </span>
      <span
        className="text-right text-success/90"
        style={{ opacity: buy > 0 ? 0.45 + 0.55 * (buy / scale) : 0.25 }}
      >
        {buy > 0 ? money(buy) : ""}
      </span>
    </div>
  );
}

/** Итоги по интервалам: сколько всего прошло и куда перевесило. */
function Totals({ columns }: { columns: ClusterColumn[] }) {
  if (columns.length === 0) return null;
  return (
    <div className="flex border-t border-border bg-bg-deep/60 font-mono text-[10px]">
      {columns.map((column) => {
        const delta = column.buy - column.sell;
        return (
          <div key={column.start} className={`${COL_W} px-1 py-1 text-right`}>
            <div className="text-text-muted">{money(column.buy + column.sell)}</div>
            <div className={delta >= 0 ? "text-success" : "text-danger"}>
              {delta >= 0 ? "+" : "−"}
              {money(Math.abs(delta))}
            </div>
          </div>
        );
      })}
      <div className={BOOK_W} />
    </div>
  );
}
