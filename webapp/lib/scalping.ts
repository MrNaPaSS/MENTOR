// Живой канал скринера и стакана.
//
// Данные идут по WebSocket, а не опросом: стакан обновляется десять раз в
// секунду, и опрос раз в секунду превращает его в замерзшую картинку — именно
// так выглядела прошлая версия раздела. Сервер сам решает, когда слать кадр;
// клиент только говорит, какой инструмент открыт.

import { onTabBack, onTabIdle } from "./idleTab";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, liveAccessToken } from "./api";

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
  /**
   * Чья это книга.
   *
   * Стакан идёт с биржи, на которой ученик торгует: плиты, спред и лента у
   * каждой свои, а заявка исполняется по своим. Поле расходится с asked, когда
   * книгу пришлось взять с общей биржи - причина в fallback.
   */
  exchange: string;
  /** Какую биржу просил клиент. Пусто - не просил, общая книга. */
  asked: string;
  /**
   * Почему книга не с той биржи, что просили: "no_symbol" - монеты там нет,
   * "no_feed" - её поток у нас не заведён. Пусто - книга своя.
   */
  fallback: string;
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
  /**
   * Профиль разобранной свечи - строками на шаге биржи.
   *
   * Едет тем же кадром, что и стакан: сделки в живую свечу приходят каждую
   * секунду, и лестница, обновляемая опросом раз в три секунды, стояла рядом
   * с бурлящим стаканом мёртвой картинкой. Пусто - разбор закрыт или своя
   * лента не застала эту свечу с начала; тогда её приносит REST.
   */
  foot: {
    time: number;
    seconds: number;
    tick: number;
    buy: number;
    sell: number;
    levels: [number, number, number][];
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
/** Сортировки, доступные в интерфейсе. Их подписи живут в словаре. */
export type VisibleSortKey = Exclude<SortKey, "spike">;

/** Порядок кнопок сортировки в терминале. */
export const SORT_KEYS: VisibleSortKey[] = [
  "walls", "volume", "delta", "range", "imbalance", "spread", "change",
];


// Пауза перед переподключением растёт до потолка: если сервер лежит, долбить
// его каждые полсекунды бессмысленно.
const RECONNECT_MIN = 500;
const RECONNECT_MAX = 10_000;

function wsUrl(token: string | null): string {
  const base = API_URL.replace(/^http/, "ws");
  // Токен - чтобы сервер знал купленные инструменты: глубину стакана, шаг ×25
  // и разбор свечи он отдаёт только по ним. Без токена - бесплатный уровень.
  return `${base}/ws/scalping${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

type Options = {
  symbol: string | null;
  /**
   * Биржа, книгу которой смотрит ученик: та, где стоит его активный счёт.
   *
   * Пусто - общая книга Binance: так у тех, кто счёт ещё не подключил.
   */
  exchange?: string;
  rows: number;
  agg: number;
  sort: SortKey;
  /** Порог полки ликвидности в деньгах — считает его сервер. */
  shelf: number;
  /** Таймфрейм графика: по нему сервер складывает живую свечу. */
  interval: string;
  /**
   * Начало разобранной свечи, секунды. Ноль - разбор закрыт.
   *
   * Профиль весит больше всего остального в кадре, и слать его, пока лестницу
   * никто не открыл, незачем.
   */
  foot: number;
};

// Последний список монет держим в сессии вкладки: при возврате в раздел он
// показывается сразу, а не через секунду ожидания первого кадра. Данные в нём
// секундной давности — для выбора инструмента этого достаточно, а живые цифры
// приезжают следом.
const SCREENER_CACHE = "nmnh.scalping.screener";
/** Как часто переписывать кэш скринера: он нужен только первой отрисовке. */
const SCREENER_CACHE_EVERY_MS = 5_000;

/** Тот же ли состав у множества и списка - без оглядки на порядок. */
function sameMembers(current: ReadonlySet<string>, next: string[]): boolean {
  if (current.size !== next.length) return false;
  return next.every((one) => current.has(one));
}

function cachedScreener(): ScreenerRow[] {
  try {
    const raw = sessionStorage.getItem(SCREENER_CACHE);
    const rows = raw ? JSON.parse(raw) : null;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function useScalpingFeed({
  symbol,
  exchange = "",
  rows,
  agg,
  sort,
  shelf,
  interval,
  foot,
}: Options) {
  const [screener, setScreener] = useState<ScreenerRow[]>([]);
  // Монеты, которых нет на бирже ученика. Список идёт с Binance, торгует он у
  // себя: монета, которой у его биржи нет, до сих пор выдавала себя только
  // после нажатия - подменённой книгой.
  const [absent, setAbsent] = useState<ReadonlySet<string>>(new Set());
  const [dom, setDom] = useState<DomFrame | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(RECONNECT_MIN);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Настройки читаем из ref: пересоздавать соединение при смене шага сетки
  // незачем, достаточно отправить команду.
  const optsRef = useRef({ symbol, exchange, rows, agg, sort, shelf, interval, foot });
  // Когда кэш скринера писали последний раз.
  const cachedAtRef = useRef(0);
  optsRef.current = { symbol, exchange, rows, agg, sort, shelf, interval, foot };

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
    // Вкладку давно не видно: канал закрыт намеренно, переподключаться не
    // надо, пока человек не вернётся (lib/idleTab.ts).
    let paused = false;

    async function connect() {
      if (closed || paused) return;
      // Токен - живой, а не тот, что лежит в хранилище: после обрыва сети
      // спустя четверть часа сокет переподключался с истёкшим, и сервер отдавал
      // купившему глубину и разбор свечи только бесплатный уровень до F5.
      const token = await liveAccessToken().catch(() => null);
      if (closed || paused) return;
      const ws = new WebSocket(wsUrl(token));
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
              exchange: o.exchange,
              rows: o.rows,
              agg: o.agg,
              shelf: o.shelf,
              interval: o.interval,
            }),
          );
          if (o.foot > 0) ws.send(JSON.stringify({ action: "foot", time: o.foot }));
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
          const payload = message.payload as { rows: ScreenerRow[]; absent?: string[] };
          setScreener(payload.rows ?? []);
          // Поля нет вовсе, пока сервер не знает состава биржи: пометить весь
          // список чужим хуже, чем не пометить ничего.
          //
          // Новое множество - только если состав сменился: каждое новое, даже
          // с тем же содержимым, перерисовывало всю таблицу скринера.
          const nextAbsent = payload.absent ?? [];
          setAbsent((current) => (sameMembers(current, nextAbsent) ? current : new Set(nextAbsent)));
          // Кэш списка нужен только для первой отрисовки после перезагрузки:
          // писать его синхронно на каждое сообщение незачем.
          const now = Date.now();
          if (now - cachedAtRef.current >= SCREENER_CACHE_EVERY_MS) {
            cachedAtRef.current = now;
            try {
              sessionStorage.setItem(SCREENER_CACHE, JSON.stringify(payload.rows ?? []));
            } catch {
              // Приватное окно - переживём без кэша.
            }
          }
        } else if (message.event === "dom") {
          const frame = message.payload as DomFrame;
          if (ourFrame(frame, optsRef.current)) setDom(frame);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (closed || paused) return;
        timerRef.current = setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, RECONNECT_MAX);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    // Вкладку не видно дольше минуты - канал закрываем: сервер перестаёт
    // собирать для неё кадр стакана восемь раз в секунду. Вернулись -
    // подключаемся сразу, без выжидания паузы переподключения.
    const offIdle = onTabIdle(() => {
      paused = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
    });
    const offBack = onTabBack(() => {
      if (!paused) return;
      paused = false;
      retryRef.current = RECONNECT_MIN;
      void connect();
    });

    return () => {
      closed = true;
      offIdle();
      offBack();
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  // Смена инструмента: старый стакан сразу убираем, иначе на экране на долю
  // секунды останутся цены прошлой монеты.
  useEffect(() => {
    setDom(null);
    send({ action: "symbol", symbol, exchange, rows, agg, shelf, interval });
  }, [symbol, exchange, rows, agg, shelf, interval, send]);

  useEffect(() => {
    send({ action: "sort", sort });
  }, [sort, send]);

  // Какую свечу разобрал трейдер. Отдельной командой, а не в подписке на
  // инструмент: лестницу открывают и закрывают чаще, чем меняют монету, а
  // смена монеты стоит серверу удержания нового стакана.
  useEffect(() => {
    send({ action: "foot", time: foot });
  }, [foot, send]);

  return { screener, absent, dom, connected };
}

/**
 * Кадр стакана про то, что сейчас на экране.
 *
 * Подписка меняется мгновенно, а кадр прежней монеты уже в пути: он приходил
 * следом и рисовался как текущий. С ценой и плитой SpaceX в шапке BTC и одной
 * гигантской свечой на весь график - переключение с дешёвой монеты на дорогую
 * ломало экран до следующего кадра.
 *
 * Биржу сверяем по `asked` - что клиент просил, а не что сервер дал: книга
 * могла прийти с общей биржи, и это законно (`fallback`).
 */
export function ourFrame(
  frame: { symbol?: string; asked?: string },
  // Символ может быть пустым: монета ещё не выбрана, и кадров тогда нет.
  want: { symbol: string | null; exchange?: string },
): boolean {
  if (frame.symbol && frame.symbol !== want.symbol) return false;
  if (frame.asked && want.exchange && frame.asked !== want.exchange) return false;
  return true;
}

// ── форматирование чисел ────────────────────────────────────────────────────

/** Деньги коротко: 1.2M, 340K. Длинные числа в таблице не читаются. */
export function money(value: number): string {
  const abs = Math.abs(value);
  // Триллионы нужны разделу «Рынок»: капитализация всех монет вместе - это
  // единицы триллионов, и в миллиардах она читалась как «3400.00B».
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
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
