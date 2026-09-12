"use client";

// Столбики одного ряда: дни недели, часы, любой разрез во времени.
//
// Раньше это были голые прямоугольники на пустом поле: по ним было видно, что
// вторник выше среды, и больше ничего - ни сколько это в деньгах, ни где ноль,
// ни какой день лучший. Теперь у ряда есть своя система координат: сетка с
// подписями сумм, нулевая линия, значение над лучшим и худшим столбиком и
// подсветка того, на что смотреть.
//
// Координаты считаем в точках, а не в долях: столбик в две точки высотой и
// подпись под ним должны попадать в одни и те же места при любой ширине.
//
// У часов к этому добавляются полосы торговых сессий за спиной столбиков и
// тонкая полоса активности под осью: деньги и число сделок - разные вещи, и
// час с одной удачной сделкой не должен выглядеть как час, в который торгуют.

import { useEffect, useMemo, useRef, useState } from "react";

export interface BarItem {
  key: string;
  /** Подпись под столбиком. Пусто - подписи нет, но место под неё есть. */
  label: string;
  value: number;
  /** Что показать в подсказке помимо значения: например, число сделок. */
  note?: string;
  /** Выбран ли столбик: по нему отфильтрован раздел. */
  active?: boolean;
}

/** Полоса за столбиками: сутки, разбитые на торговые сессии. */
export interface Band {
  /** Индексы столбиков, которые полоса накрывает: от и до, не включая. */
  from: number;
  to: number;
  label: string;
}

export interface BarsProps {
  items: readonly BarItem[];
  height: number;
  /**
   * Второй ряд за основным: сколько сделок было.
   *
   * Деньги и активность - разные вещи: час с одной удачной сделкой даёт
   * столбик выше, чем час с десятью ровными, и по одному ряду не отличить
   * «здесь повезло» от «здесь торгуют». Фоновый ряд ставит их рядом.
   */
  back?: readonly number[];
  /** Полосы сессий за столбиками: по ним видно, где азия, а где америка. */
  bands?: readonly Band[];
  /** Значение словами - для подсказки и подписей. */
  format: (value: number) => string;
  /** Нажатие по столбику: им фильтруют раздел. Нет - столбики не нажимаются. */
  onPick?: (key: string) => void;
  /** Короткая запись суммы для боковой шкалы. Нет - берётся `format`. */
  short?: (value: number) => string;
}

/** Поля: слева под подписи сумм, снизу под названия столбиков. */
const PAD = { top: 14, right: 4, bottom: 16, left: 40 };
/** Сколько линий сетки рисуем по каждую сторону от нуля. */
const LINES = 2;

export default function Bars({ items, height, format, onPick, short, back, bands }: BarsProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    watch?.observe(el);
    return () => watch?.disconnect();
  }, []);

  const view = useMemo(() => {
    const peak = Math.max(1, ...items.map((item) => Math.abs(item.value)));
    const hasLoss = items.some((item) => item.value < 0);
    // Шкала ровная в обе стороны от нуля, когда минусы есть: иначе столбик
    // вниз на ту же сумму выглядит вдвое меньше столбика вверх.
    const innerH = Math.max(1, height - PAD.top - PAD.bottom);
    const zeroY = PAD.top + (hasLoss ? innerH / 2 : innerH);
    const scale = (hasLoss ? innerH / 2 : innerH) / peak;

    const best = items.reduce((top, item) => (item.value > top.value ? item : top), items[0]);
    const worst = items.reduce((low, item) => (item.value < low.value ? item : low), items[0]);

    const grid: { value: number; y: number }[] = [];
    for (let i = -LINES; i <= LINES; i++) {
      if (!hasLoss && i < 0) continue;
      const value = (peak / LINES) * i;
      grid.push({ value, y: zeroY - value * scale });
    }

    return { peak, hasLoss, zeroY, scale, grid, best, worst, innerH };
  }, [items, height]);

  const label = short ?? format;

  const backPeak = back && back.length > 0 ? Math.max(1, ...back) : 0;

  return (
    <div ref={box} className="relative select-none" style={{ height }}>
      {/* Полосы сессий: подпись сверху и своя подложка, чтобы «утро» и
          «вечер» читались без счёта часов по подписям снизу. */}
      {bands?.map((band, i) => (
        <div
          key={band.label}
          className="pointer-events-none absolute"
          style={{
            left: `calc(${PAD.left}px + (100% - ${PAD.left + PAD.right}px) * ${band.from / items.length})`,
            width: `calc((100% - ${PAD.left + PAD.right}px) * ${(band.to - band.from) / items.length})`,
            top: 0,
            bottom: PAD.bottom,
            background: i % 2 === 0 ? "var(--pane-hover)" : "transparent",
            opacity: 0.7,
          }}
        >
          <span className="absolute left-1 top-0 text-[8px] uppercase tracking-wider text-[var(--pane-muted)]">
            {band.label}
          </span>
        </div>
      ))}

      {/* Сетка с подписями сумм: без них высота столбика ничего не значит. */}
      {width > 0 &&
        view.grid.map((line) => (
          <div key={line.value} className="pointer-events-none absolute inset-x-0" style={{ top: line.y }}>
            <div
              className="absolute inset-x-0 border-t"
              style={{
                left: PAD.left,
                borderColor: "var(--pane-border)",
                opacity: Math.abs(line.value) < 1e-9 ? 0.9 : 0.4,
                borderStyle: Math.abs(line.value) < 1e-9 ? "solid" : "dashed",
              }}
            />
            <span
              className="absolute -translate-y-1/2 font-mono text-[8px] text-[var(--pane-muted)]"
              style={{ left: 0, width: PAD.left - 6, textAlign: "right" }}
            >
              {label(line.value)}
            </span>
          </div>
        ))}

      {/* Сами столбики: ряд равных долей, каждая со своей подписью. */}
      <div
        className="absolute inset-0 flex items-stretch gap-[3px]"
        style={{ left: PAD.left, right: PAD.right }}
      >
        {items.map((item) => {
          const up = item.value >= 0;
          const size = Math.abs(item.value) * view.scale;
          const bar = item.value === 0 ? 0 : Math.max(2, size);
          const peakOne = item.key === view.best?.key && item.value > 0;
          const worstOne = item.key === view.worst?.key && item.value < 0;
          const lit = hover === item.key || item.active || peakOne || worstOne;
          const color = up ? "var(--pane-up)" : "var(--pane-down)";

          const load = backPeak > 0 && back ? (back[items.indexOf(item)] ?? 0) / backPeak : 0;

          const body = (
            <>
              {/* Активность полосой под осью, а не столбиком за спиной: второй
                  ряд столбиков пересекал нулевую линию и читался как убыток. */}
              {backPeak > 0 && (
                <span
                  className="absolute rounded-[2px] transition-[opacity] duration-300"
                  style={{
                    left: 1,
                    right: 1,
                    top: height - PAD.bottom - 4,
                    height: 3,
                    background: "var(--pane-text-2)",
                    opacity: 0.12 + load * 0.6,
                  }}
                />
              )}
              <span
                className="absolute rounded-[3px] transition-[height,opacity] duration-300"
                style={{
                  left: 0,
                  right: 0,
                  top: up ? view.zeroY - bar : view.zeroY,
                  height: bar,
                  background: color,
                  opacity: lit ? 1 : 0.62,
                }}
              />
              {/* Значение подписываем у лучшего, худшего и того, на что смотрят:
                  подписать всё - значит превратить ряд в текст. */}
              {(peakOne || worstOne || hover === item.key) && item.value !== 0 && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] font-bold"
                  style={{
                    top: up ? view.zeroY - bar - 13 : view.zeroY + bar + 2,
                    color,
                  }}
                >
                  {format(item.value)}
                </span>
              )}
              <span
                className="absolute inset-x-0 truncate text-center text-[8px] text-[var(--pane-muted)]"
                style={{ top: height - PAD.bottom + 3 }}
              >
                {item.label}
              </span>
            </>
          );

          const title = `${item.label || item.key}: ${format(item.value)}${item.note ? ` · ${item.note}` : ""}`;

          return onPick ? (
            <button
              key={item.key}
              type="button"
              onClick={() => onPick(item.key)}
              onMouseEnter={() => setHover(item.key)}
              onMouseLeave={() => setHover(null)}
              title={title}
              className="relative min-w-0 flex-1 rounded transition-colors hover:bg-[var(--pane-hover)]"
            >
              {body}
            </button>
          ) : (
            <div
              key={item.key}
              onMouseEnter={() => setHover(item.key)}
              onMouseLeave={() => setHover(null)}
              title={title}
              className="relative min-w-0 flex-1 cursor-default rounded transition-colors hover:bg-[var(--pane-hover)]"
            >
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
