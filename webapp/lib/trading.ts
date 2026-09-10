// Связь терминала с биржевым счётом ученика.
//
// Ключи на сервере, а не в браузере: их нужно уметь применять и тогда, когда
// вкладка закрыта — стоп в безубыток переносится сам. Сюда ключ уходит один
// раз при подключении и обратно не возвращается никогда.

import { authReq } from "./api";
import { getAccessToken } from "./auth";
import { setTakerFee, type ActiveTrade } from "./trade/position";
import { readBook, type LivePosition, type PositionBook } from "./trade/exchange";

export type { LivePosition, PositionBook };

export type TradingStatus = {
  /** Хранилище ключей настроено на сервере. */
  enabled: boolean;
  /** Ключи этого ученика подключены. */
  connected: boolean;
  key_tail: string;
  updated_at: string | null;
  /**
   * Ставка комиссии этого трейдера, доля от оборота одной ноги.
   *
   * Считается по его же закрытым сделкам: у каждого она своя, от уровня VIP.
   * Пусто - сделок с комиссией ещё нет, и терминал считает по справочной.
   */
  taker_fee?: number | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = getAccessToken();
  if (!token) return null;
  // Через общий authReq: он обновляет протухший токен и повторяет запрос. Без
  // этого ордер не уходил бы на биржу через четверть часа после входа в
  // кабинет, а причина выглядела бы как отказ биржи.
  return authReq<T>(path, token, init);
}

export async function tradingStatus(): Promise<TradingStatus | null> {
  const body = await request<TradingStatus>("/api/trading/status");
  // Ставку запоминаем здесь, а не у каждого, кто спрашивает состояние: считает
  // по ней расчёт сделки, и знать о ней он должен независимо от того, кто
  // именно спросил - терминал, профиль или шапка кабинета.
  if (body) setTakerFee(body.taker_fee);
  return body;
}

export function saveKeys(api_key: string, secret_key: string, passphrase: string) {
  return request<{ ok: boolean; key_tail: string }>("/api/trading/keys", {
    method: "PUT",
    body: JSON.stringify({ api_key, secret_key, passphrase }),
  });
}

export function dropKeys() {
  return request<{ ok: boolean }>("/api/trading/keys", { method: "DELETE" });
}

export function balance() {
  return request<{ balance: unknown }>("/api/trading/balance");
}

/**
 * Отправить сделку на биржу ровно тем расчётом, который видит трейдер.
 *
 * Ничего не пересчитывается по дороге: расхождение между тем, что показано на
 * экране, и тем, что ушло на биржу, — самая дорогая ошибка из возможных.
 */
export function openPosition(trade: ActiveTrade, entryAsLimit: boolean) {
  return request<{
    entry: unknown;
    takes: unknown[];
    watched: string;
    /** Позиция открыта, но что-то из сопровождения не встало сразу. */
    warning: string;
  }>("/api/trading/open", {
    method: "POST",
    body: JSON.stringify({
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.qty,
      leverage: trade.leverage,
      entry: entryAsLimit ? trade.entry : null,
      stop: trade.initialStop,
      takes: trade.targets,
      client_order_id: trade.id.slice(0, 64),
    }),
  });
}

/**
 * Зафиксировать позицию на бирже: долю от того, что открыто.
 *
 * Объём считает сервер по факту с биржи, а не терминал: часть могла уже
 * закрыться целями, и приказ на исходный объём биржа отклонит целиком.
 */
export function closePosition(trade: ActiveTrade, share: number) {
  return request<{
    closed: number;
    remaining: number;
    note?: string;
    /** Что на самом деле пришло на счёт: результат с биржи, а не наша оценка. */
    realized?: number | null;
    fee?: number | null;
    fill_price?: number | null;
  }>(
    "/api/trading/close",
    {
      method: "POST",
      body: JSON.stringify({
        symbol: trade.symbol,
        side: trade.side,
        share,
        client_order_id: `${trade.id}_x${trade.partials + 1}`.slice(0, 64),
        // Какую сделку снимаем: по инструменту их может идти несколько, и
        // снятие одной не должно уносить защиту соседней.
        trade_id: trade.id.slice(0, 64),
      }),
    },
  );
}

/** Что из защиты реально стоит на бирже и по каким ценам. */
export type ExchangePlans = {
  stops: number;
  takes: number;
  /** Цена стопа с биржи. Своя цифра расходилась с ней на сотню пунктов. */
  stop_price: number | null;
  take_prices: number[];
  /** Сколько целей было поставлено. Ноль - лестницы на бирже не было вовсе. */
  placed_takes: number;
  /** Сколько целей сопровождение засчитало взятыми. */
  takes_hit: number;
  /**
   * Чьи входы ещё стоят на бирже и ждут своей цены.
   *
   * Биржа отдаёт одну сводную позицию на монету и сторону: две лимитки на
   * покупку по ней неразличимы, и обе выглядели исполнившимися. Отличить их
   * можно только так - по тому, стоит ли ещё сама заявка.
   */
  resting: string[];
  /**
   * Когда вход состоялся на самом деле, по сделкам сервера.
   *
   * Терминал видит исполнение только на той монете, которая открыта. Пока
   * трейдер смотрел другую, вход состоялся молча, и началом сделки становился
   * момент возвращения: бокс на графике вставал не туда, где сделка началась.
   * Сопровождение на сервере обходит все монеты и время знает.
   */
  opened?: Record<string, string | null>;
};

/**
 * Спросить биржу, стоят ли стоп и цели.
 *
 * График рисует их по замыслу сделки. Когда биржа заявку не приняла, картинка
 * успокаивает вместо того, чтобы предупредить, - а на кону вся защита позиции.
 */
export function plansOf(symbol: string) {
  return request<ExchangePlans>(`/api/trading/plans/${symbol.toUpperCase()}`);
}

/**
 * Попросить сопровождение проверить сделки сейчас, не дожидаясь его обхода.
 *
 * Стоп в безубыток после взятой цели переставляет сервер, а терминал видит
 * цель раньше него. Без просьбы стоп переезжал с опозданием - и цена успевала
 * вернуться к старому.
 */
export function nudgeWatcher() {
  return request<{ checked: boolean }>("/api/trading/nudge", { method: "POST" });
}

/** Куда трейдер перетащил уровень. Шлём только то, что сдвинулось. */
export type LevelMove = {
  symbol: string;
  side: "long" | "short";
  entry?: number;
  stop?: number;
  take?: number;
  take_index?: number;
  trade_id?: string;
};

/**
 * Перенести вход, стоп или цель на новую цену.
 *
 * Отправляется, когда трейдер отпустил квадрат, а не пока тянет: каждый кадр
 * перетаскивания - это запрос к бирже, а биржа считает такое частотой запросов
 * и отвечает отказом.
 *
 * Ответ - состояние по бирже. Рисовать надо его, а не то, куда трейдер
 * дотянул: биржа округляет цену до своего шага и вправе отказать вовсе.
 */
export function moveLevels(body: LevelMove) {
  return request<{
    entry: number;
    stop: number;
    takes: number[];
    /** Позиции ещё нет: двигали замысел ждущей заявки. */
    planned: boolean;
  }>("/api/trading/move", { method: "POST", body: JSON.stringify(body) });
}

/** Пределы инструмента: их задаёт биржа, и знать их нужно до ордера. */
export type SymbolLimits = {
  /** Потолок плеча по этой монете: у большинства он ×20 или ×50. */
  max_leverage: number;
  /** Комиссия тейкера: платится на входе и на выходе. */
  taker_fee: number;
  step: number;
  tick: number;
  min_qty: number;
  /** Потолок одной заявки по монете, в самой монете. Ноль - биржа не назвала. */
  max_qty: number;
  /** Потолок всей позиции по монете. */
  max_position: number;
};

/**
 * Спросить пределы инструмента.
 *
 * Кнопка ×100 на монете с потолком ×50 - это отказ биржи после нажатия
 * «Войти». Дешевле узнать заранее: справочник открыт и кэшируется на сервере.
 */
export function limitsOf(symbol: string) {
  return request<SymbolLimits>(`/api/trading/limits/${symbol.toUpperCase()}`);
}

/** Открытая позиция по инструменту глазами биржи. */
export type ExchangePosition = LivePosition & {
  /**
   * Сколько строк биржа вернула по этому инструменту и нашлась ли среди них
   * наша сторона.
   *
   * Нужно журналу, а не разметке. Пустой ответ и ответ, в котором есть чужая
   * сторона, приводят к одному и тому же нулю в объёме, но означают разное:
   * первое - позиции нет, второе - мы смотрим не туда. Различить их потом, по
   * жалобе «сделка закрылась сама», иначе нечем.
   */
  rows: number;
  matched: boolean;
  /** Сколько строк было во всём ответе. Ноль при живой позиции - заминка биржи. */
  total: number;
};

/** Пустая позиция: биржа ответила, но нашей строки в ответе нет. */
const NO_POSITION = {
  size: 0,
  entry: null,
  unrealized: null,
  breakeven: null,
} as const;

/**
 * Все открытые позиции счёта одним снимком.
 *
 * Одним запросом по всем монетам, а не по одной открытой. Лимитка исполняется
 * тогда, когда трейдер смотрит на другой график, и спрашивать по одной монете
 * значит узнать о своей же сделке в последнюю очередь. Этим же снимком живёт
 * зеркало сделки: раньше оно спрашивало биржу отдельно на каждую идущую
 * сделку, и по три-четыре запроса в секунду биржа отвечала пустотой.
 */
export async function openBook(): Promise<PositionBook | null> {
  const body = await request<{ positions: Record<string, unknown>[] }>(
    "/api/trading/positions",
  );
  if (!body) return null;
  return readBook(body.positions ?? []);
}

/** Объёмы и цены входа по ключу «монета:сторона». */
export async function openPositions(): Promise<Record<string, LivePosition> | null> {
  const book = await openBook();
  return book ? book.byKey : null;
}

/** Только объёмы: тем местам, которым цена входа не нужна. */
export async function openSizes(): Promise<Record<string, number> | null> {
  const book = await openBook();
  if (!book) return null;
  const out: Record<string, number> = {};
  for (const [key, one] of Object.entries(book.byKey)) out[key] = one.size;
  return out;
}

/** Позиция по инструменту из готового снимка. */
export function positionIn(
  book: PositionBook,
  symbol: string,
  side: "long" | "short",
): ExchangePosition {
  const sym = symbol.toUpperCase();
  const one = book.byKey[`${sym}:${side}`];
  return {
    ...(one ?? NO_POSITION),
    rows: book.rowsOf[sym] ?? 0,
    matched: Boolean(one),
    total: book.total,
  };
}

/**
 * Спросить биржу, что там с позицией.
 *
 * Терминал обязан быть зеркалом биржи, а не жить своей арифметикой: он уже
 * закрывал сделку у себя, пока позиция оставалась открытой.
 *
 * Сторона обязательна: в хедже по одному инструменту их две - лонг и шорт, - и
 * без стороны зеркало показывало бы обеим сделкам одну и ту же чужую.
 */
export async function positionOf(
  symbol: string,
  side: "long" | "short",
): Promise<ExchangePosition | null> {
  const book = await openBook();
  return book ? positionIn(book, symbol, side) : null;
}

/**
 * Сделка глазами сопровождения на сервере.
 *
 * Второе мнение о том, жива ли сделка. Биржа отвечает пустым списком позиций и
 * на своей заминке, а терминал по такому ответу хоронил разметку: трейдер
 * оставался с живой позицией на бирже и пустым экраном. Сопровождение обходит
 * биржу со своей стороны, со своей выдержкой, и пока оно сделку ведёт, хоронить
 * её нельзя.
 */
export type ServerTrade = {
  /** Наш опознаватель сделки: тот же, что у неё на графике. */
  client_id: string;
  symbol: string;
  side: "long" | "short";
  /** waiting - вход ещё ждёт своей цены, open - позиция набрана. */
  status: string;
  qty: number;
  entry: number;
  stop: number;
  takes_hit: number;
  opened_at: string | null;
};

/** Живые сделки по всем монетам. Память сервера, а не поход на биржу. */
export function liveTrades() {
  return request<{ trades: ServerTrade[] }>("/api/trading/live");
}
