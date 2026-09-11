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
  /** Комиссия обеих ног: по ней видно, почему на счёт пришло меньше. */
  fee: number;
  /** Цели, с которыми сделка задумывалась: по ним она рисуется на графике. */
  targets: number[];
  outcome: "stop" | "take" | "manual";
  pnl: number;
  opened_at: string | null;
  closed_at: string;
  note: string;
  /** Биржа сделки: код из lib/exchanges.ts. Пусто - сделка без биржи. */
  exchange?: string;
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

/** Сколько выгрузок журнала осталось в этом месяце. */
export type ExportQuota = {
  owned: boolean;
  limit: number;
  used: number;
  left: number;
  /** Когда появятся новые: первое число следующего месяца. */
  resets_at: string;
};

export function exportQuota() {
  return request<ExportQuota>("/api/journal/export");
}

/**
 * Выгрузить журнал: сделки за год для отчёта. Засчитывается сервером - три
 * выгрузки в месяц.
 */
export function exportJournal(symbol?: string) {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return request<{ trades: JournalTrade[]; quota: ExportQuota }>(`/api/journal/export${query}`, {
    method: "POST",
  });
}

/**
 * Сделки одного календарного дня.
 *
 * Отдельно от `loadTrades`: там окно «последние N дней» от сегодня, а в
 * календаре нажимают на клетку - и клетка может быть в прошлом марте.
 */
export function loadDay(date: string) {
  return request<{ trades: JournalTrade[]; summary: JournalSummary }>(
    `/api/journal/trades?date=${encodeURIComponent(date)}`,
  );
}

export function loadCalendar(year: number, month: number) {
  return request<{ days: JournalDay[]; total: number }>(
    `/api/journal/calendar?year=${year}&month=${month}`,
  );
}

/**
 * Убрать запись из журнала. Только под ключом наставника.
 *
 * Журнал - это статистика, по которой судят о торговле. Право стереть из неё
 * неудачную сделку обесценивает её целиком: остаётся красивый список, из
 * которого ничего не следует. Поэтому запрос уходит с токеном наставника, а не
 * ученика, и сервер проверяет то же самое.
 */
export function removeTrade(id: number) {
  return request<{ ok: boolean }>(`/api/journal/trades/${id}`, { method: "DELETE" });
}

/**
 * Есть ли право править журнал.
 *
 * Спрашиваем у сервера вместе с профилем: право за учётной записью, а не за
 * отдельным входом с паролем. Наставник открывает терминал под собой, и
 * логиниться вторым способом ради одной кнопки ему незачем.
 */
export async function canEditJournal(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const me = await authReq<{ is_admin?: boolean; journal_delete_allowed?: boolean }>(
    "/api/profile",
    token,
  ).catch(() => null);
  // Наставнику - всегда, ученику - если наставник выдал это право поимённо.
  // Спрашивать сервер о самом праве незачем: он всё равно проверит его на
  // удалении, а здесь решается только то, рисовать ли корзину.
  return Boolean(me?.is_admin || me?.journal_delete_allowed);
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
      fee: trade.fee ?? 0,
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
