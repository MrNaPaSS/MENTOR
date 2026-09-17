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
  /** Итог сделки за вычетом комиссии. */
  pnl: number;
  /** Сделка ещё идёт. У закрытой - `false` или поля нет вовсе. */
  live?: boolean;
  /** Сколько объёма закрыто: «взято две цели» и «закрыто 60%» - разное. */
  closed_qty?: number;
  opened_at: string | null;
  closed_at: string;
  note: string;
  /** Биржа сделки: код из lib/exchanges.ts. Пусто - сделка без биржи. */
  exchange?: string;
};

/**
 * Сделка, которая идёт прямо сейчас.
 *
 * Та же строка журнала, только без даты закрытия, а `pnl` в ней - лишь
 * зафиксированное взятыми целями. Плавающего по остатку здесь нет намеренно:
 * журнал показывает деньги, которые уже на счёте, а текущая цена живёт в
 * терминале.
 */
export type LiveJournalTrade = Omit<JournalTrade, "closed_at" | "outcome"> & {
  closed_at: null;
  outcome: "open";
  live: true;
  closed_qty: number;
  /**
   * Стоп, который стоит на бирже сейчас.
   *
   * В `stop` у записи журнала - тот, с которым сделка задумывалась: по нему
   * считается риск, и менять его нельзя. А карточке нужен нынешний: стоп,
   * переехавший в безубыток, это первое, что на ней хотят видеть.
   */
  stop_now?: number;
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

/**
 * Итог одной биржи за тот же период.
 *
 * Суммы разных бирж не складываются в одной строке отчёта - это требование
 * учёта, а не вкус: одна строка принадлежит одному счёту. По этому же списку
 * рисуется переключатель бирж, поэтому он приходит полным и тогда, когда одна
 * биржа уже выбрана.
 */
export type VenueSlice = {
  exchange: string;
  count: number;
  pnl: number;
  wins: number;
  losses: number;
};

/** Сделки без биржи: торговля по стакану, без подключённого счёта. */
export const NO_VENUE = "none";

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

export type TradeListing = {
  trades: JournalTrade[];
  /**
   * Сделки, которые идут прямо сейчас.
   *
   * Отдельным списком, а не вместе с закрытыми: их результат ещё изменится, и
   * в итогах периода - сумме, проценте прибыльных - им места нет.
   */
  live?: LiveJournalTrade[];
  summary: JournalSummary;
  /** Разрез по биржам за тот же период: по нему рисуется переключатель. */
  by_exchange: VenueSlice[];
  /** Биржа, на которую уходят новые сделки: с неё открывается журнал. */
  active: string;
};

export function loadTrades(days = 90, symbol?: string, exchange?: string) {
  const query = new URLSearchParams({ days: String(days) });
  if (symbol) query.set("symbol", symbol);
  if (exchange) query.set("exchange", exchange);
  return request<TradeListing>(`/api/journal/trades?${query}`);
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
export function exportJournal(symbol?: string, exchange?: string) {
  const query = new URLSearchParams();
  if (symbol) query.set("symbol", symbol);
  // Отчёт наследует биржу того экрана, с которого его заказали: два счёта в
  // одной бумаге не сходятся ни с одним из них.
  if (exchange) query.set("exchange", exchange);
  const tail = query.size ? `?${query}` : "";
  return request<{ trades: JournalTrade[]; quota: ExportQuota }>(`/api/journal/export${tail}`, {
    method: "POST",
  });
}

/**
 * Сделки одного календарного дня.
 *
 * Отдельно от `loadTrades`: там окно «последние N дней» от сегодня, а в
 * календаре нажимают на клетку - и клетка может быть в прошлом марте.
 */
export function loadDay(date: string, exchange?: string) {
  const query = new URLSearchParams({ date });
  if (exchange) query.set("exchange", exchange);
  return request<TradeListing>(`/api/journal/trades?${query}`);
}

export function loadCalendar(year: number, month: number, exchange?: string) {
  const query = new URLSearchParams({ year: String(year), month: String(month) });
  if (exchange) query.set("exchange", exchange);
  return request<{ days: JournalDay[]; total: number; by_exchange: VenueSlice[] }>(
    `/api/journal/calendar?${query}`,
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
  const me = await authReq<{ journal_delete_allowed?: boolean }>("/api/profile", token).catch(
    () => null,
  );
  // Право поимённое, и наставник тут не исключение: снятый себе флажок должен
  // убирать корзину и у него, иначе выключить его себе нельзя вовсе. Сервер
  // всё равно проверит право на удалении - здесь решается только то, рисовать
  // ли кнопку.
  return Boolean(me?.journal_delete_allowed);
}

/**
 * Записать закрытую сделку.
 *
 * Идентификатор берётся с клиента: повторная отправка после обрыва связи
 * обновит запись, а не заведёт вторую такую же.
 */
export function saveTrade(trade: ActiveTrade, exchange?: string) {
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
      // Биржа сделки. Без счёта её нет вовсе: торговля шла по стакану, и
      // приписывать такую запись чужой бирже значит испортить её отчёт.
      exchange: exchange ?? "",
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
