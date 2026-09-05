"use client";

// Скальпинг: скринер, стакан и график.
//
// Раскладка рабочая, а не настроечная: слева узкий список монет, справа — стакан
// выбранной и её график. Ширины фиксированы, высота тянется во весь экран:
// стакан и график должны заканчиваться на одной линии, иначе под одним из них
// остаётся пустота в треть экрана.
//
// Настроек минимум и все по делу: шаг ценовой шкалы и глубина у стакана,
// таймфрейм и индикаторы у графика. Прошлая версия начиналась с семи
// переключателей и шести захардкоженных пар, и пользоваться этим было нельзя.

import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import PaneDivider from "@/components/scalping/PaneDivider";
import ScreenerTable from "@/components/scalping/ScreenerTable";
import DomTrader from "@/components/scalping/DomTrader";
import PriceChart, { type Indicators } from "@/components/scalping/PriceChart";
import {
  base,
  useScalpingFeed,
  SORT_LABELS,
  type SortKey,
  type VisibleSortKey,
} from "@/lib/scalping";

// Укрупнение ценовой шкалы. На BTC шаг биржи — десять центов, и без укрупнения
// сорок строк стакана укладываются в четыре доллара. ×10 — из настроек
// заказчика (PriceScaleMultiplier).
const STEPS = [
  { agg: 1, label: "×1" },
  { agg: 5, label: "×5" },
  { agg: 10, label: "×10" },
  { agg: 25, label: "×25" },
];

// Ступени для колеса мыши. Мельче, чем кнопки: четыре пресета — это не
// масштабирование, а четыре скачка. Промежуточные ступени дают плавность,
// кнопки остаются быстрым переходом к привычным значениям.
const ZOOM_LADDER = [1, 2, 3, 5, 8, 10, 15, 20, 25, 40, 50, 75, 100];

// 30 — глубина из рабочего пространства заказчика (DomAutoscaleDepth).
const DEPTHS = [30, 60, 100];

// Минута открывается по умолчанию: это рабочий масштаб скальпера. Остальные
// нужны, чтобы посмотреть, откуда цена пришла.
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"];

const INDICATOR_LABELS: Record<keyof Indicators, string> = {
  structure: "Структура",
  blocks: "Блоки",
  gaps: "FVG",
  shelves: "Полки",
  levels: "Уровни",
  zones: "Зоны",
  ema: "EMA",
  volume: "Объём",
};

// Отклик на нажатие: 150 мс ease-out и лёгкое сжатие. Кнопка должна показать,
// что интерфейс услышал палец, не дожидаясь новых данных.
const CHIP =
  "rounded px-1.5 py-0.5 text-[11px] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]";
const CHIP_ON = "bg-accent-cyan/15 text-accent-cyan";
const CHIP_OFF = "text-text-muted hover:text-text-primary";

// Высота рабочей области: всё окно за вычетом шапки приложения и заголовка
// раздела. Стакан и график получают одинаковую высоту и заканчиваются на одной
// линии — иначе под коротким из них остаётся пустота в треть экрана.
const PANE_H = "h-[calc(100vh-190px)] min-h-[520px]";

// Ширины панелей по умолчанию и границы, за которые их не утянуть.
// Нижняя граница стакана — 111 (колонка истории) + 177 (цена) плюс поля:
// уже этого он перестаёт быть читаемым.
const PANE_LIMITS = {
  screener: { def: 500, min: 360, max: 900 },
  dom: { def: 620, min: 320, max: 1200 },
};

const STORAGE_KEY = "nmnh.scalping.panes";

// По умолчанию включено всё, кроме зон: они заливают половину окна сплошным
// цветом и нужны, только когда смотришь картину крупнее минуты.
const DEFAULT_INDICATORS: Indicators = {
  structure: true,
  shelves: true,
  blocks: true,
  gaps: true,
  levels: true,
  ema: true,
  volume: true,
  zones: false,
};

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.max(min, Math.min(max, value));
}

/** Настройки рабочего места, которые переживают перезагрузку страницы. */
type Workspace = {
  screener: number;
  dom: number;
  indicators: Indicators;
  sort: SortKey;
  timeframe: string;
  agg: number;
  rows: number;
};

function readWorkspace(): Partial<Workspace> | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return null;
  }
}

export default function ScalpingPage() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("walls");
  const [agg, setAgg] = useState(10);
  const [rows, setRows] = useState(30);
  const [timeframe, setTimeframe] = useState("1m");
  const [indicators, setIndicators] = useState<Indicators>(DEFAULT_INDICATORS);

  const [screenerW, setScreenerW] = useState(PANE_LIMITS.screener.def);
  const [domW, setDomW] = useState(PANE_LIMITS.dom.def);

  const { screener, dom, connected } = useScalpingFeed({ symbol, rows, agg, sort });

  // Рабочее место трейдера живёт в его браузере: ширины панелей, набор
  // индикаторов, таймфрейм, шаг и глубина стакана. Настроил один раз — и после
  // перезагрузки всё на месте, а не сброшено к заводскому.
  useEffect(() => {
    const saved = readWorkspace();
    if (!saved) return;
    if (typeof saved.screener === "number") {
      setScreenerW(clamp(saved.screener, PANE_LIMITS.screener));
    }
    if (typeof saved.dom === "number") setDomW(clamp(saved.dom, PANE_LIMITS.dom));
    // Индикаторы сливаем с умолчаниями: если в новой версии появился
    // переключатель, которого в сохранённом наборе нет, он не должен пропасть.
    if (saved.indicators) {
      setIndicators({ ...DEFAULT_INDICATORS, ...saved.indicators });
    }
    if (saved.sort && saved.sort in SORT_LABELS) setSort(saved.sort);
    if (saved.timeframe && TIMEFRAMES.includes(saved.timeframe)) {
      setTimeframe(saved.timeframe);
    }
    if (typeof saved.agg === "number" && STEPS.some((s) => s.agg === saved.agg)) {
      setAgg(saved.agg);
    }
    if (typeof saved.rows === "number" && DEPTHS.includes(saved.rows)) setRows(saved.rows);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          screener: screenerW,
          dom: domW,
          indicators,
          sort,
          timeframe,
          agg,
          rows,
        } satisfies Workspace),
      );
    } catch {
      // Не сохранилось — не повод ломать экран.
    }
  }, [screenerW, domW, indicators, sort, timeframe, agg, rows]);

  // NaN приходит по двойному клику на разделителе — это сброс к умолчанию.
  function resizeScreener(delta: number) {
    setScreenerW((w) =>
      Number.isNaN(delta) ? PANE_LIMITS.screener.def : clamp(w + delta, PANE_LIMITS.screener),
    );
  }

  function resizeDom(delta: number) {
    setDomW((w) => (Number.isNaN(delta) ? PANE_LIMITS.dom.def : clamp(w + delta, PANE_LIMITS.dom)));
  }

  function toggle(key: keyof Indicators) {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /**
   * Масштаб стакана колесом мыши, как на графике.
   *
   * Вверх — мельче шаг и подробнее уровни, вниз — крупнее шаг и шире охват.
   * Ищем ближайшую ступень к текущему значению: попасть можно и кнопкой, и
   * колесом, и они не обязаны совпадать.
   */
  function zoomDom(direction: 1 | -1) {
    setAgg((current) => {
      let nearest = 0;
      for (let i = 1; i < ZOOM_LADDER.length; i++) {
        if (
          Math.abs(ZOOM_LADDER[i] - current) < Math.abs(ZOOM_LADDER[nearest] - current)
        ) {
          nearest = i;
        }
      }
      const next = Math.max(0, Math.min(ZOOM_LADDER.length - 1, nearest + direction));
      return ZOOM_LADDER[next];
    });
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Скальпинг</h1>
          <p className="text-sm text-text-muted">
            Крупные заявки в стаканах топовых монет — обновление живьём
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
            connected
              ? "border-success/40 bg-success/10 text-success"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "поток биржи" : "нет связи"}
        </span>
      </header>

      <div
        className="flex flex-col gap-3 xl:flex-row xl:gap-0"
        style={
          {
            "--screener-w": `${screenerW}px`,
            "--dom-w": `${domW}px`,
          } as React.CSSProperties
        }
      >
        {/* Скринер: ширина по своим колонкам, без растягивания. */}
        <section
          className={`flex shrink-0 flex-col rounded-xl border border-border bg-bg-card xl:w-[var(--screener-w)] ${PANE_H}`}
        >
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-2">
            <span className="mr-1 text-[11px] text-text-muted">Сортировка:</span>
            {(Object.keys(SORT_LABELS) as VisibleSortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`${CHIP} ${
                  sort === key ? CHIP_ON : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ScreenerTable
              rows={screener}
              selected={symbol}
              sort={sort}
              onSort={setSort}
              onSelect={setSymbol}
            />
          </div>
        </section>

        <PaneDivider onResize={resizeScreener} title="Ширина списка · двойной клик сбрасывает" />

        {symbol ? (
          <>
            {/* Стакан: ширина по своим колонкам, история прокручивается влево. */}
            <section
              className={`flex shrink-0 flex-col rounded-xl border border-border bg-bg-card xl:w-[var(--dom-w)] ${PANE_H}`}
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="font-semibold text-text-primary">{base(symbol)}</span>
                <div className="flex items-center gap-0.5">
                  {STEPS.map((step) => (
                    <button
                      key={step.agg}
                      onClick={() => setAgg(step.agg)}
                      title="Шаг ценовой шкалы"
                      className={`${CHIP} ${agg === step.agg ? CHIP_ON : CHIP_OFF}`}
                    >
                      {step.label}
                    </button>
                  ))}
                  <span className="mx-1 h-3 w-px bg-border" />
                  {DEPTHS.map((depth) => (
                    <button
                      key={depth}
                      onClick={() => setRows(depth)}
                      title="Глубина стакана, строк"
                      className={`${CHIP} ${rows === depth ? CHIP_ON : CHIP_OFF}`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1">
                {dom ? (
                  <DomTrader frame={dom} onZoom={zoomDom} />
                ) : (
                  <p className="grid h-full place-items-center text-sm text-text-muted">
                    Собираем стакан {base(symbol)}…
                  </p>
                )}
              </div>
            </section>

            <PaneDivider onResize={resizeDom} title="Ширина стакана · двойной клик сбрасывает" />

            {/* График занимает всё оставшееся место. */}
            <section
              className={`flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-bg-card ${PANE_H}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex items-center gap-0.5">
                  <span className="mr-1 text-[11px] text-text-secondary">{base(symbol)}</span>
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      title="Таймфрейм"
                      className={`${CHIP} ${timeframe === tf ? CHIP_ON : CHIP_OFF}`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-0.5">
                  {(Object.keys(INDICATOR_LABELS) as (keyof Indicators)[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => toggle(key)}
                      className={`${CHIP} ${indicators[key] ? CHIP_ON : CHIP_OFF}`}
                    >
                      {INDICATOR_LABELS[key]}
                    </button>
                  ))}
                  {dom?.wall && (
                    <span className="ml-2 text-[11px] text-accent-gold">плита на графике</span>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 p-1">
                <PriceChart
                  symbol={symbol}
                  interval={timeframe}
                  wall={dom?.wall ?? null}
                  shelves={dom?.shelves ?? []}
                  indicators={indicators}
                />
              </div>
            </section>
          </>
        ) : (
          <section
            className={`grid flex-1 place-items-center rounded-xl border border-border bg-bg-card px-6 text-center text-sm text-text-muted ${PANE_H}`}
          >
            Выберите монету в списке — здесь появятся её стакан и график
          </section>
        )}
      </div>
    </div>
  );
}
