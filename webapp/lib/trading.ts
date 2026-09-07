// Связь терминала с биржевым счётом ученика.
//
// Ключи на сервере, а не в браузере: их нужно уметь применять и тогда, когда
// вкладка закрыта — стоп в безубыток переносится сам. Сюда ключ уходит один
// раз при подключении и обратно не возвращается никогда.

import { authReq } from "./api";
import { getAccessToken } from "./auth";
import type { ActiveTrade } from "./trade/position";

export type TradingStatus = {
  /** Хранилище ключей настроено на сервере. */
  enabled: boolean;
  /** Ключи этого ученика подключены. */
  connected: boolean;
  key_tail: string;
  updated_at: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = getAccessToken();
  if (!token) return null;
  // Через общий authReq: он обновляет протухший токен и повторяет запрос. Без
  // этого ордер не уходил бы на биржу через четверть часа после входа в
  // кабинет, а причина выглядела бы как отказ биржи.
  return authReq<T>(path, token, init);
}

export function tradingStatus() {
  return request<TradingStatus>("/api/trading/status");
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

/** Пределы инструмента: их задаёт биржа, и знать их нужно до ордера. */
export type SymbolLimits = {
  /** Потолок плеча по этой монете: у большинства он ×20 или ×50. */
  max_leverage: number;
  /** Комиссия тейкера: платится на входе и на выходе. */
  taker_fee: number;
  step: number;
  tick: number;
  min_qty: number;
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
export type ExchangePosition = {
  size: number;
  entry: number | null;
  unrealized: number | null;
  /** Цена безубытка по расчёту биржи: с комиссией, фандингом и реальным входом. */
  breakeven: number | null;
};

/**
 * Спросить биржу, что там с позицией.
 *
 * Терминал обязан быть зеркалом биржи, а не жить своей арифметикой: он уже
 * закрывал сделку у себя, пока позиция оставалась открытой.
 */
export async function positionOf(
  symbol: string,
  /**
   * Сторона позиции. В хедже по одному инструменту их две — лонг и шорт, — и
   * без стороны зеркало показывало бы обеим сделкам одну и ту же чужую.
   */
  side?: "long" | "short",
): Promise<ExchangePosition | null> {
  const body = await request<{ positions: Record<string, unknown>[] }>(
    "/api/trading/positions",
  );
  if (!body) return null;

  const mine = body.positions.filter(
    (p) => String(p.symbol ?? "").toUpperCase() === symbol.toUpperCase(),
  );
  const sideOf = (p: Record<string, unknown>) =>
    String(p.positionSide ?? p.holdSide ?? p.side ?? "").toLowerCase();
  // Сторону сверяем, только если биржа её назвала: в одностороннем режиме поля
  // может не быть вовсе, и тогда позиция по инструменту ровно одна.
  const row = side
    ? mine.find((p) => sideOf(p).includes(side)) ??
      (mine.length === 1 && !sideOf(mine[0]) ? mine[0] : undefined)
    : mine[0];
  if (!row) return { size: 0, entry: null, unrealized: null, breakeven: null };

  const numeric = (...names: string[]) => {
    for (const name of names) {
      const value = Number(row[name]);
      if (Number.isFinite(value) && value !== 0) return value;
    }
    return null;
  };

  // Средней цены входа в ответе WEEX нет - есть «сколько денег зашло» и «на
  // какой объём». Отношение и есть средняя, и считать результат нужно от неё:
  // от задуманного уровня цифра расходится с биржевой в разы.
  const openValue = numeric("cumOpenValue", "openValue") ?? 0;
  const openSize = numeric("cumOpenSize") ?? 0;
  const average = openValue > 0 && openSize > 0 ? openValue / openSize : null;

  return {
    size: Math.abs(numeric("total", "size", "positionAmt", "available") ?? 0),
    entry: numeric("averageOpenPrice", "entryPrice", "avgPrice") ?? average,
    unrealized: numeric("unrealizePnl", "unrealizedPnl", "unrealizedProfit", "unrealisedPnl"),
    breakeven: numeric("breakEvenPrice", "breakevenPrice", "breakEven", "bePrice"),
  };
}
