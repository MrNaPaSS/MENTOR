// Живой канал скринера и стакана.
//
// Данные идут по WebSocket, а не опросом: стакан обновляется десять раз в
// секунду, и опрос раз в секунду превращает его в замерзшую картинку — именно
// так выглядела прошлая версия раздела. Сервер сам решает, когда слать кадр;
// клиент только говорит, какой инструмент открыт.

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

export type ScreenerRow = {
  symbol: string;
  price: number;
  change_pct: number;
  volume_24h: number;
  spread_bp: number;
  book_ratio: number;
  delta_notional: number;
  buy_ratio: number;
  trades_per_min: number;
  spike: number;
  range_bp: number;
  wall_notional: number;
  wall_side: "bid" | "ask" | "";
  wall_price: number;
  wall_distance_bp: number;
  live: boolean;
};

export type LadderRow = {
  price: number;
  bid: number;
  ask: number;
  notional: number;
  is_wall: boolean;   // крупная заявка относительно соседей по своей стороне
  /**
   * Крупная заявка по абсолютной сумме — от порога, который задал трейдер.
   *
   * Плита ищется «кратно выше медианы», и на редком стакане ею оказывается и
   * сотня тысяч. Это другой признак: деньги, а не соотношение.
   */
  whale: boolean;
  strong: boolean;    // имбаланс: сторона втрое перевешивает противоположную
  cum: number;
};

export type Wall = {
  price: number;
  size: number;
  notional: number;
  side: "bid" | "ask";
  distance_bp: number;
  ratio: number;
};

/** Один интервал истории: [цена, покупки, продажи] по каждой строке экрана. */
export type ClusterColumn = {
  start: number;
  buy: number;
  sell: number;
  cells: [number, number, number][];
};

export type DomFrame = {
  symbol: string;
  tick: number;
  best_bid: number;
  best_ask: number;
  mid: number;
  book_ratio: number;
  rows: LadderRow[];
  wall: Wall | null;
  /** Полки ликвидности: уровни с деньгами от выбранного трейдером порога. */
  shelves: Wall[];
  clusters: ClusterColumn[];
  /**
   * Текущая свеча, собранная из ленты сделок.
   *
   * Приходит с каждым кадром стакана — восемь раз в секунду. История свечей
   * по-прежнему тянется по REST, но текущая рисуется сразу, а не с задержкой
   * до следующего опроса.
   */
  candle: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null;
};

export type SortKey =
  | "volume"
  | "walls"
  | "spike"
  | "delta"
  | "range"
  | "imbalance"
  | "spread"
  | "change";

// «Всплеск» из интерфейса убран: он сравнивает текущую активность с нормой
// монеты, а норма набирается за минуты — в списке колонка стояла ровно ×1.0 и
// только занимала ширину. Метрика остаётся в ответе бэкенда на будущее.
/** Сортировки, доступные в интерфейсе. */
export type VisibleSortKey = Exclude<SortKey, "spike">;

export const SORT_LABELS: Record<VisibleSortKey, string> = {
  walls: "Плиты",
  volume: "Оборот",
  delta: "Дельта",
  range: "Ход",
  imbalance: "Перевес",
  spread: "Спред",
  change: "Изменение",
};

// Пауза перед переподключением растёт до потолка: если сервер лежит, долбить
// его каждые полсекунды бессмысленно.
const RECONNECT_MIN = 500;
const RECONNECT_MAX = 10_000;

function wsUrl(): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws/scalping`;
}

type Options = {
  symbol: string | null;
  rows: number;
  agg: number;
  sort: SortKey;
  /** Порог полки ликвидности в деньгах — считает его сервер. */
  shelf: number;
  /** Таймфрейм графика: по нему сервер складывает живую свечу. */
  interval: string;
};

// Последний список монет держим в сессии вкладки: при возврате в раздел он
// показывается сразу, а не через секунду ожидания первого кадра. Данные в нём
// секундной давности — для выбора инструмента этого достаточно, а живые цифры
// приезжают следом.
const SCREENER_CACHE = "nmnh.scalping.screener";

function cachedScreener(): ScreenerRow[] {
  try {
    const raw = sessionStorage.getItem(SCREENER_CACHE);
    const rows = raw ? JSON.parse(raw) : null;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function useScalpingFeed({ symbol, rows, agg, sort, shelf, interval }: Options) {
  const [screener, setScreener] = useState<ScreenerRow[]>([]);
  const [dom, setDom] = useState<DomFrame | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(RECONNECT_MIN);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Настройки читаем из ref: пересоздавать соединение при смене шага сетки
  // незачем, достаточно отправить команду.
  const optsRef = useRef({ symbol, rows, agg, sort, shelf, interval });
  optsRef.current = { symbol, rows, agg, sort, shelf, interval };

  const send = useCallback((message: object) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  // Пока идёт первое подключение, показываем прошлый список.
  useEffect(() => {
    const cached = cachedScreener();
    if (cached.length > 0) setScreener((current) => (current.length > 0 ? current : cached));
  }, []);

  useEffect(() => {
    let closed = false;

    function connect() {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      socketRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        setConnected(true);
        retryRef.current = RECONNECT_MIN;
        const o = optsRef.current;
        ws.send(JSON.stringify({ action: "sort", sort: o.sort }));
        if (o.symbol) {
          ws.send(
            JSON.stringify({
              action: "symbol",
              symbol: o.symbol,
              rows: o.rows,
              agg: o.agg,
              shelf: o.shelf,
              interval: o.interval,
            }),
          );
        }
      };

      ws.onmessage = (event) => {
        let message: { event?: string; payload?: unknown };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.event === "screener") {
          const payload = message.payload as { rows: ScreenerRow[] };
          setScreener(payload.rows ?? []);
          try {
            sessionStorage.setItem(SCREENER_CACHE, JSON.stringify(payload.rows ?? []));
          } catch {
            // Приватное окно — переживём без кэша.
          }
        } else if (message.event === "dom") {
          setDom(message.payload as DomFrame);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (closed) return;
        timerRef.current = setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, RECONNECT_MAX);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  // Смена инструмента: старый стакан сразу убираем, иначе на экране на долю
  // секунды останутся цены прошлой монеты.
  useEffect(() => {
    setDom(null);
    send({ action: "symbol", symbol, rows, agg, shelf, interval });
  }, [symbol, rows, agg, shelf, interval, send]);

  useEffect(() => {
    send({ action: "sort", sort });
  }, [sort, send]);

  return { screener, dom, connected };
}

// ── форматирование чисел ────────────────────────────────────────────────────

/** Деньги коротко: 1.2M, 340K. Длинные числа в таблице не читаются. */
export function money(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${Math.round(value / 1e3)}K`;
  return value.toFixed(0);
}

/** Цена с числом знаков по её порядку: у DOGE и BTC он разный. */
export function price(value: number, tick = 0): string {
  if (!value) return "-";
  let digits = 2;
  if (tick > 0) {
    digits = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))));
  } else if (value < 1) digits = 6;
  else if (value < 100) digits = 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Формат цены для графика: шаг сетки и число знаков.
 *
 * По умолчанию библиотека рисует шкалу с шагом в один цент. На дешёвых монетах
 * весь видимый диапазон меньше этого шага: подписи выходят одинаковыми, а
 * одинаковые библиотека не показывает - на DOGE ценовая шкала оказывалась
 * пустой. Шаг берём биржевой, а когда он неизвестен - по величине самой цены.
 */
export function priceFormat(tick: number, value = 0): { precision: number; minMove: number } {
  let step = tick;
  if (!(step > 0)) {
    if (value >= 1000) step = 0.1;
    else if (value >= 100) step = 0.01;
    else if (value >= 1) step = 0.0001;
    else if (value >= 0.01) step = 0.000001;
    else step = 0.00000001;
  }
  const precision = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - 1e-9)));
  return { precision, minMove: step };
}

/** Время начала интервала в виде ЧЧ:ММ. */
export function clockLabel(startSeconds: number): string {
  const d = new Date(startSeconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Короткое имя инструмента: BTCUSDT → BTC. */
export function base(symbol: string): string {
  return symbol.replace(/USDT$/, "");
}
