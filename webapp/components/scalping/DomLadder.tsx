"use client";

// Стакан заявок: единая ценовая шкала, аски сверху, биды снизу.
//
// Строка не двигается при каждом обновлении: высота фиксирована, а цена служит
// ключом — меняются только цифры и длина полосы. Иначе на десяти кадрах в
// секунду таблица дрожала бы и читать её было бы невозможно.

import { memo, useEffect, useMemo, useRef } from "react";
import { money, price as fmtPrice, type DomFrame, type LadderRow } from "@/lib/scalping";

const ROW_HEIGHT = 22;

export default function DomLadder({ frame }: { frame: DomFrame }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);

  const askCount = useMemo(() => frame.rows.filter((r) => r.ask > 0).length, [frame.rows]);

  // Объём самой крупной строки задаёт масштаб полос. Берём максимум по всему
  // окну, иначе при смене монеты масштаб скачет и полосы «дышат».
  const maxNotional = useMemo(
    () => Math.max(1, ...frame.rows.map((r) => r.notional)),
    [frame.rows],
  );

  // Один раз после загрузки ставим спред в середину видимой области. Дальше
  // прокрутку не трогаем: трейдер мог увести взгляд на дальнюю плиту.
  useEffect(() => {
    centered.current = false;
  }, [frame.symbol]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || centered.current || frame.rows.length === 0) return;
    el.scrollTop = Math.max(0, askCount * ROW_HEIGHT - el.clientHeight / 2);
    centered.current = true;
  }, [askCount, frame.rows.length]);

  return (
    <div className="flex h-full flex-col">
      <Header frame={frame} />

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto font-mono text-[11px]"
      >
        {frame.rows.map((row, index) => {
          const items = [];
          if (index === askCount && askCount > 0) {
            items.push(<SpreadRow key="spread" frame={frame} />);
          }
          items.push(
            <Row key={row.price} row={row} tick={frame.tick} scale={maxNotional} />,
          );
          return items;
        })}
      </div>
    </div>
  );
}

/** Шапка: цена, спред и перевес — то, на что смотрят, не отрывая глаз. */
function Header({ frame }: { frame: DomFrame }) {
  const spreadBp = frame.mid > 0 ? ((frame.best_ask - frame.best_bid) / frame.mid) * 10_000 : 0;
  const buy = Math.round(frame.book_ratio * 100);

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-semibold text-text-primary">
          {fmtPrice(frame.mid, frame.tick)}
        </span>
        <span className="text-[11px] text-text-muted">
          спред {spreadBp.toFixed(1)} б.п.
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="w-8 text-right font-mono text-[10px] text-danger">{100 - buy}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-sm bg-bg-deep">
          <div className="bg-success/70 transition-all" style={{ width: `${buy}%` }} />
          <div className="bg-danger/70 transition-all" style={{ width: `${100 - buy}%` }} />
        </div>
        <span className="w-8 font-mono text-[10px] text-success">{buy}</span>
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

/** Разрыв между лучшим бидом и лучшим аском. */
function SpreadRow({ frame }: { frame: DomFrame }) {
  return (
    <div
      className="flex items-center justify-center border-y border-accent-cyan/30 bg-accent-cyan/5 text-[10px] text-accent-cyan"
      style={{ height: ROW_HEIGHT }}
    >
      {fmtPrice(frame.best_bid, frame.tick)} · {fmtPrice(frame.best_ask, frame.tick)}
    </div>
  );
}

const Row = memo(function Row({
  row,
  tick,
  scale,
}: {
  row: LadderRow;
  tick: number;
  scale: number;
}) {
  const isBid = row.bid > 0;
  const width = Math.min(100, (row.notional / scale) * 100);

  return (
    <div
      className={`relative flex items-center justify-between px-3 ${
        row.is_wall ? "bg-accent-gold/10" : ""
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      {/* Полоса объёма живёт под текстом и растёт от края к центру. */}
      <div
        className={`absolute inset-y-0.5 ${isBid ? "left-0 bg-success/20" : "left-0 bg-danger/20"}`}
        style={{ width: `${width}%` }}
      />

      <span
        className={`relative z-10 ${
          row.is_wall ? "font-semibold text-accent-gold" : "text-text-secondary"
        }`}
      >
        {fmtPrice(row.price, tick)}
      </span>

      <span
        className={`relative z-10 ${
          row.is_wall
            ? "font-semibold text-accent-gold"
            : isBid
              ? "text-success"
              : "text-danger"
        }`}
      >
        {money(row.notional)}
      </span>
    </div>
  );
});
