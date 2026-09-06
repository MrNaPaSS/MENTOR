// Журнал сделок: связь терминала с сервером.
//
// Журнал живёт на сервере, а не в браузере, намеренно: он попадает в календарь
// прибыли и должен открываться на любом устройстве. Без входа в кабинет журнал
// просто выключен — писать некуда, и притворяться, что записалось, нельзя.

import { authReq } from "./api";
import { getAccessToken } from "./auth";
import type { ActiveTrade } from "./trade/position";

export type JournalTrade = {
  id: number;
  client_id: string;
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  exit_price: number | null;
  qty: number;
  margin: number;
  leverage: number;
  takes_hit: number;
  /** Цели, с которыми сделка задумывалась: по ним она рисуется на графике. */
  targets: number[];
  outcome: "stop" | "take" | "manual";
  pnl: number;
  opened_at: string | null;
  closed_at: string;
  note: string;
};

export type JournalSummary = {
  count: number;
  pnl: number;
  wins: number;
  losses: number;
  win_rate: number;
  best: number;
  worst: number;
};

export type JournalDay = {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = getAccessToken();
  if (!token) return null;
  // Через общий authReq: он обновляет протухший токен и повторяет запрос. Свой
  // fetch означал бы, что через четверть часа сделки молча перестают
  // записываться — ровно это и случилось на боевом счёте.
  return authReq<T>(path, token, init);
}

/** Есть ли куда писать журнал: без входа в кабинет — нет. */
export function journalAvailable(): boolean {
  return Boolean(getAccessToken());
}

export function loadTrades(days = 90, symbol?: string) {
  const query = new URLSearchParams({ days: String(days) });
  if (symbol) query.set("symbol", symbol);
  return request<{ trades: JournalTrade[]; summary: JournalSummary }>(
    `/api/journal/trades?${query}`,
  );
}

export function loadCalendar(year: number, month: number) {
  return request<{ days: JournalDay[]; total: number }>(
    `/api/journal/calendar?year=${year}&month=${month}`,
  );
}

export function removeTrade(id: number) {
  return request<{ ok: boolean }>(`/api/journal/trades/${id}`, { method: "DELETE" });
}

/**
 * Записать закрытую сделку.
 *
 * Идентификатор берётся с клиента: повторная отправка после обрыва связи
 * обновит запись, а не заведёт вторую такую же.
 */
export function saveTrade(trade: ActiveTrade) {
  if (trade.status !== "closed") return Promise.resolve(null);
  return request<JournalTrade>("/api/journal/trades", {
    method: "POST",
    body: JSON.stringify({
      client_id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      entry: trade.entry,
      // В журнал идёт стоп, с которым сделка задумывалась: по нему считался
      // риск. Перенос в безубыток — это уже управление позицией.
      stop: trade.initialStop,
      exit_price: trade.exit ?? undefined,
      qty: trade.qty,
      margin: trade.margin,
      leverage: trade.leverage,
      takes_hit: trade.takesHit,
      targets: trade.targets,
      outcome: trade.outcome ?? "manual",
      pnl: trade.pnl,
      opened_at: trade.openedAt ? new Date(trade.openedAt).toISOString() : null,
      closed_at: new Date(trade.closedAt ?? Date.now()).toISOString(),
      note: "",
    }),
  });
}

export function loadWorkspace() {
  return request<{ payload: Record<string, unknown> | null; updated_at: string | null }>(
    "/api/journal/workspace",
  );
}

export function saveWorkspace(payload: Record<string, unknown>) {
  return request<{ ok: boolean }>("/api/journal/workspace", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
