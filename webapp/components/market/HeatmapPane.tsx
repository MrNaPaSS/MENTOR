"use client";

// Тепловая карта рынка - своя, вместо встроенного скрипта TradingView.
//
// Размер плитки - оборот за сутки, цвет - изменение цены. Оборот, а не
// капитализация: терминал про то, где сегодня торгуют, а не про то, кто
// дороже стоит. Сорок пар - столько плиток остаются читаемыми на телефоне.
//
// Рисуется на `recharts`, который уже в зависимостях: заводить ради одной
// карты `d3` незачем.

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { ResponsiveContainer, Treemap } from "recharts";

import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { buildTiles, formatChange, tileColor, type Tile } from "@/lib/heatmap";
import { askSymbol } from "@/lib/openSymbol";
import Pane, { type PaneState } from "./Pane";
import SourceMark from "./SourceMark";
import type { Origin } from "@/lib/marketOrigin";

/** Как часто обновляем карту. Оборот за сутки меняется медленно. */
const POLL_MS = 30_000;

interface TileNode extends Tile {
  /** `recharts` кладёт размер в поле с этим именем. */
  value: number;
  /** Своим узлам `recharts` разрешает любые поля - об этом и подпись. */
  [key: string]: unknown;
}

interface TileShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  base?: string;
  change?: number;
  symbol?: string;
  /** Нажатие на плитку открывает пару в терминале. */
  onOpen?: (symbol: string) => void;
}

/**
 * Одна плитка.
 *
 * Подписи прячутся на мелких плитках: обрезанное слово читается как мусор, а
 * цвет работает и без подписи.
 */
function TileShape(props: TileShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, base = "", change = 0, symbol = "", onOpen } = props;
  const showName = width > 44 && height > 26;
  const showChange = width > 56 && height > 42;

  return (
    <g
      onClick={() => symbol && onOpen?.(symbol)}
      style={{ cursor: symbol ? "pointer" : "default" }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={tileColor(change)}
        stroke="var(--pane-bg)"
        strokeWidth={1}
      />
      {showName && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showChange ? 6 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[var(--pane-text)] text-[11px] font-semibold"
        >
          {base}
        </text>
      )}
      {showChange && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 9}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[var(--pane-text)] font-mono text-[10px] tabular-nums opacity-80"
        >
          {formatChange(change)}
        </text>
      )}
    </g>
  );
}

export default function HeatmapPane({
  className = "",
  height = 520,
}: {
  className?: string;
  height?: number;
}) {
  const t = useT();
  const router = useRouter();
  const [tiles, setTiles] = useState<TileNode[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [state, setState] = useState<PaneState>("loading");

  useEffect(() => {
    let dropped = false;
    function load() {
      api
        .marketTickers()
        .then((r) => {
          if (dropped) return;
          const built = buildTiles(r.tickers ?? []).map((tile) => ({ ...tile, value: tile.size }));
          setTiles(built);
          setOrigin({ source: r.source ?? null, stale: r.stale });
          setState(built.length ? "ready" : "error");
        })
        .catch(() => {
          if (!dropped) setState("error");
        });
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Pane
      icon={<LayoutGrid className="h-3.5 w-3.5" />}
      title={t.market.widgets.heatmap.title}
      hint={t.market.widgets.heatmap.hint}
      badge={<SourceMark origin={origin} />}
      state={state}
      emptyNote={t.market.pane.emptyNote}
      className={className}
      bodyClass="p-2"
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={tiles}
            dataKey="value"
            isAnimationActive={false}
            content={
              <TileShape
                onOpen={(symbol) => {
                  // Терминал открыт - услышит событие; закрыт - прочтёт пару
                  // из адреса при открытии.
                  askSymbol(symbol);
                  router.push(`/app/scalping?symbol=${symbol}`);
                }}
              />
            }
          />
        </ResponsiveContainer>
      </div>
    </Pane>
  );
}
