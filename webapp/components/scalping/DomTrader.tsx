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
// История прокручивается влево, а колонка стакана закреплена у правого края:
// уходить взглядом вглубь истории можно, не теряя из виду текущие заявки.
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

// Ширины из рабочего пространства заказчика (Tiger.Trade): ClusterWidth=111 для
// профиля bid/ask, DomWidth=177 на колонку стакана.
// shrink-0 обязателен: слева от них стоит распорка, которая забирает всё
// свободное место и прижимает цену к правому краю.
const COL_W = "w-[111px] shrink-0";
const BOOK_W = "w-[177px] shrink-0";

// Насколько близко к правому краю считается «смотрю на свежее». Полколонки:
// попасть прокруткой ровно в край невозможно.
const EDGE_SLACK = 56;

/** Ячейки истории приходят тройками — раскладываем в карту по цене строки. */
function indexCells(columns: ClusterColumn[]): Map<number, [number, number]>[] {
  return columns.map((column) => {
    const map = new Map<number, [number, number]>();
    for (const [price, buy, sell] of column.cells) map.set(price, [buy, sell]);
    return map;
  });
}

export default function DomTrader({
  frame,
  onZoom,
  onPickLevel,
}: {
  frame: DomFrame;
  /** Колесо мыши меняет масштаб: +1 крупнее шаг, −1 мельче. */
  onZoom?: (direction: 1 | -1) => void;
  /** Нажатие по строке с заявками — расчёт сделки от этого уровня. */
  onPickLevel?: (row: LadderRow) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  // Держаться ли правого края при появлении новой минуты.
  const stickRight = useRef(true);

  const askCount = useMemo(() => frame.rows.filter((r) => r.ask > 0).length, [frame.rows]);

  // Порядок колонок — от старой к свежей, поэтому свежая минута оказывается
  // вплотную к цене, а прошлое уходит влево. Пустые колонки пропускаем: пока
  // история набиралась, они съедали ширину, отведённую стакану.
  const columns = useMemo(
    () => frame.clusters.filter((c) => c.cells.length > 0),
    [frame.clusters],
  );
  const cells = useMemo(() => indexCells(columns), [columns]);

  // Масштаб полос — по самой крупной строке стакана в окне. Считаем по всему
  // окну, иначе при каждом обновлении полосы «дышали» бы.
  const bookScale = useMemo(
    () => Math.max(1, ...frame.rows.map((r) => r.notional)),
    [frame.rows],
  );
  // История масштабируется своей величиной: объём за минуту и объём стоящей
  // заявки — величины разного порядка, общий масштаб убил бы одну из них.
  const clusterScale = useMemo(() => {
    let max = 1;
    for (const map of cells) {
      for (const [buy, sell] of map.values()) max = Math.max(max, buy, sell);
    }
    return max;
  }, [cells]);

  // Смена монеты или масштаба — повод заново поставить цену в середину:
  // после укрупнения шага строки другие, и прежняя прокрутка ни на что не
  // указывает.
  useEffect(() => {
    centered.current = false;
  }, [frame.symbol, frame.tick]);

  // Масштаб — на Ctrl или Alt с колесом. Само колесо листает стакан, как и
  // раньше: отдать ему масштаб значило бы отобрать прокрутку, которой
  // пользуются постоянно, ради жеста, который нужен изредка.
  //
  // Слушатель нативный: React вешает wheel пассивно, и отменить через него
  // масштабирование страницы по Ctrl нельзя — вместе со стаканом уезжал бы
  // весь интерфейс.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onZoom) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.altKey) return;
      event.preventDefault();
      onZoom?.(event.deltaY > 0 ? 1 : -1);
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoom]);

  // Один раз ставим спред в середину экрана. Дальше вертикальную прокрутку не
  // трогаем: трейдер мог увести взгляд на дальнюю плиту, и рывок сбил бы его.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || centered.current || frame.rows.length === 0) return;
    el.scrollTop = Math.max(0, askCount * ROW_HEIGHT - el.clientHeight / 2);
    el.scrollLeft = el.scrollWidth;
    centered.current = true;
    // Шаг в зависимостях: после масштабирования строк столько же, но цены у них
    // другие, и центрировать надо заново.
  }, [askCount, frame.rows.length, frame.tick]);

  // С каждой новой минутой история уезжает влево, а свежая колонка остаётся у
  // цены. Но только пока трейдер сам смотрит на свежее: если он отмотал в
  // прошлое, дёргать его нельзя — он там что-то разглядывает.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRight.current) return;
    el.scrollLeft = el.scrollWidth;
  }, [columns.length]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // Запас в полколонки: попасть мышью ровно в край невозможно.
    const edge = el.scrollWidth - el.clientWidth - EDGE_SLACK;
    stickRight.current = el.scrollLeft >= edge;
  }

  return (
    <div className="flex h-full flex-col text-[11px] tabular-nums">
      <Header frame={frame} />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        title="Колесо — прокрутка, Ctrl+колесо — масштаб"
        className="relative flex-1 overflow-auto font-mono"
      >
        <div className="w-full min-w-max">
          <VolumeHeader columns={columns} />

          {frame.rows.map((row, index) => {
            const items = [];
            if (index === askCount && askCount > 0) {
              items.push(<SpreadRow key="spread" frame={frame} />);
            }
            items.push(
              <Row
                key={row.price}
                row={row}
                tick={frame.tick}
                cells={cells}
                bookScale={bookScale}
                clusterScale={clusterScale}
                onPick={onPickLevel}
              />,
            );
            return items;
          })}

          <TimeFooter columns={columns} />
        </div>
      </div>
    </div>
  );
}

/** Шапка: цена, спред, перевес и самая крупная заявка рядом. */
function Header({ frame }: { frame: DomFrame }) {
  const spreadBp = frame.mid > 0 ? ((frame.best_ask - frame.best_bid) / frame.mid) * 10_000 : 0;
  const buy = Math.round(frame.book_ratio * 100);

  return (
    <div className="border-b border-[var(--pane-border)] px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-semibold text-[var(--pane-text)]">
          {fmtPrice(frame.mid, frame.tick)}
        </span>
        <span className="text-[11px] text-[var(--pane-muted)]">спред {spreadBp.toFixed(1)} б.п.</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="w-7 text-right font-mono text-[10px] text-[var(--pane-down)]">{100 - buy}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-sm bg-[var(--pane-deep)]">
          <div className="bg-[var(--pane-up-bar)]" style={{ width: `${buy}%` }} />
          <div className="bg-[var(--pane-down-bar)]" style={{ width: `${100 - buy}%` }} />
        </div>
        <span className="w-7 font-mono text-[10px] text-[var(--pane-up)]">{buy}</span>
      </div>

      {frame.wall && (
        <p className="mt-2 text-[11px] text-[var(--pane-gold)]">
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
      className="flex items-center border-y border-[var(--pane-accent-soft)] bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex-1" />
      <div
        className={`sticky right-0 ${BOOK_W} flex items-center justify-between bg-[var(--pane-bg)] px-2`}
      >
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
  onPick,
}: {
  row: LadderRow;
  tick: number;
  cells: Map<number, [number, number]>[];
  bookScale: number;
  clusterScale: number;
  onPick?: (row: LadderRow) => void;
}) {
  const isBid = row.bid > 0;
  const width = Math.min(100, (row.notional / bookScale) * 100);
  // Считать сделку есть от чего только там, где стоят заявки: пустая строка —
  // это просто цена, от неё ни входа, ни стопа.
  const pickable = Boolean(onPick) && row.notional > 0;

  return (
    <div
      onClick={pickable ? () => onPick?.(row) : undefined}
      title={pickable ? "Расчёт сделки от этого уровня" : undefined}
      className={`flex items-center ${isBid ? "bg-[var(--pane-up-faint)]" : "bg-[var(--pane-down-faint)]"} ${
        pickable
          ? "cursor-pointer ring-[var(--pane-accent)] transition-shadow duration-150 ease-out hover:ring-1 hover:ring-inset"
          : ""
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex-1" />
      {cells.map((map, i) => (
        <ClusterCell key={i} cell={map.get(row.price)} scale={clusterScale} />
      ))}

      {/* Гистограмма внутри строки, процентами от максимума в окне: так настроен
          стакан заказчика (DomRuler=Percents, position=inside). Колонка
          закреплена справа — история уезжает под неё при прокрутке. */}
      <div
        className={`sticky right-0 ${BOOK_W} relative flex items-center justify-between bg-[var(--pane-bg)] px-2`}
      >
        <div
          className={`absolute inset-y-[2px] left-0 ${
            row.is_wall
              ? "bg-[var(--pane-gold-soft)]"
              : row.strong
                ? isBid
                  ? "bg-[var(--pane-up-strong)]"
                  : "bg-[var(--pane-down-strong)]"
                : isBid
                  ? "bg-[var(--pane-up-soft)]"
                  : "bg-[var(--pane-down-soft)]"
          }`}
          style={{ width: `${width}%` }}
        />
        <span
          className={`relative z-10 ${
            row.is_wall
              ? "font-semibold text-[var(--pane-gold)]"
              : row.strong
                ? "font-semibold text-[var(--pane-text)]"
                : isBid
                  ? "text-[var(--pane-up)]"
                  : "text-[var(--pane-down)]"
          }`}
        >
          {money(row.notional)}
        </span>
        <span className="relative z-10 text-[var(--pane-text-2)]">{fmtPrice(row.price, tick)}</span>
      </div>
    </div>
  );
});

/** Ячейка истории: слева продажи, справа покупки — как в референсе. */
function ClusterCell({ cell, scale }: { cell: [number, number] | undefined; scale: number }) {
  if (!cell) return <div className={COL_W} />;
  const [buy, sell] = cell;
  return (
    <div className={`flex ${COL_W} items-center justify-end gap-1.5 px-1.5`}>
      <span
        className="text-right text-[var(--pane-down)]"
        style={{ opacity: sell > 0 ? 0.45 + 0.55 * (sell / scale) : 0.25 }}
      >
        {sell > 0 ? money(sell) : ""}
      </span>
      <span
        className="text-right text-[var(--pane-up)]"
        style={{ opacity: buy > 0 ? 0.45 + 0.55 * (buy / scale) : 0.25 }}
      >
        {buy > 0 ? money(buy) : ""}
      </span>
    </div>
  );
}

/**
 * Шапка истории: сколько прошло за интервал и куда перевесило.
 *
 * Итоги стоят сверху, а время — под колонками: сумма свечи важнее её метки, и
 * читать её удобнее там, куда взгляд попадает первым. Время внизу работает
 * подписью оси, как на графике.
 */
function VolumeHeader({ columns }: { columns: ClusterColumn[] }) {
  return (
    <div className="sticky top-0 z-20 flex bg-[var(--pane-bg)] font-mono text-[10px] shadow-[0_1px_0_var(--pane-border)]">
      <div className="flex-1" />
      {columns.map((column) => {
        const delta = column.buy - column.sell;
        return (
          <div key={column.start} className={`${COL_W} px-1.5 py-1 text-right`}>
            <div className="text-[var(--pane-muted)]">{money(column.buy + column.sell)}</div>
            <div className={delta >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}>
              {delta >= 0 ? "+" : "−"}
              {money(Math.abs(delta))}
            </div>
          </div>
        );
      })}
      <div
        className={`sticky right-0 ${BOOK_W} flex items-end justify-end bg-[var(--pane-bg)] py-1 pr-2 text-[var(--pane-muted)]`}
      >
        объём · цена
      </div>
    </div>
  );
}

/** Подвал истории: время интервалов. */
function TimeFooter({ columns }: { columns: ClusterColumn[] }) {
  if (columns.length === 0) return null;
  return (
    <div className="sticky bottom-0 z-20 flex bg-[var(--pane-deep)] font-mono text-[10px] text-[var(--pane-muted)] shadow-[0_-1px_0_var(--pane-border)]">
      <div className="flex-1" />
      {columns.map((column) => (
        <div key={column.start} className={`${COL_W} py-1 text-center`}>
          {clockLabel(column.start)}
        </div>
      ))}
      <div className={`sticky right-0 ${BOOK_W} bg-[var(--pane-deep)]`} />
    </div>
  );
}
