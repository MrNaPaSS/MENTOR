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
      }),
    },
  );
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

  return {
    size: Math.abs(numeric("total", "size", "positionAmt", "available") ?? 0),
    entry: numeric("averageOpenPrice", "entryPrice", "avgPrice"),
    unrealized: numeric("unrealizedPnl", "unrealizedProfit", "unrealisedPnl"),
    breakeven: numeric("breakEvenPrice", "breakevenPrice", "breakEven", "bePrice"),
  };
}
