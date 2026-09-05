// Связь терминала с биржевым счётом ученика.
//
// Ключи на сервере, а не в браузере: их нужно уметь применять и тогда, когда
// вкладка закрыта — стоп в безубыток переносится сам. Сюда ключ уходит один
// раз при подключении и обратно не возвращается никогда.

import { API_URL } from "./api";
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
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    // Причина отказа нужна трейдеру дословно: «биржа отклонила ордер» без
    // текста биржи не говорит ничего.
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Ошибка ${res.status}`);
  }
  return (await res.json()) as T;
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
