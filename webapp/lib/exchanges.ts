// Биржи терминала: код, подпись на карточке и витрина условий.
//
// Терминал будет мультибиржевым, и карточка итога подписывается той биржей,
// где сделка открыта: «WEEX Futures» под печатью. Код приходит от сервера - у
// сделки журнала и у ключа счёта. Тот же список держит core/exchanges.py.

import { authReq } from "./api";
import { getAccessToken } from "./auth";

export const VENUES: Record<string, string> = {
  weex: "WEEX Futures",
  binance: "Binance Futures",
  okx: "OKX Futures",
  bingx: "BingX Futures",
  mexc: "MEXC Futures",
  bybit: "Bybit Futures",
  bitget: "Bitget Futures",
};

/** Подпись биржи. Неизвестная или пустая - пусто: карточка без подписи. */
export function venueTitle(code: string | null | undefined): string {
  return VENUES[(code ?? "").trim().toLowerCase()] ?? "";
}

// ── витрина бирж ────────────────────────────────────────────────────────────
//
// Условия, способ подключения и состояние своих счетов приходят одной ручкой
// `/api/exchanges`: витрина без своих счетов - реклама, счета без условий -
// список кодов.

/** Состояние брокерской программы на бирже. */
export type BrokerState = "talks" | "applied" | "live";

export type VenueRow = {
  exchange: string;
  name: string;
  title: string;
  /** Терминал уже торгует на этой бирже. */
  trading: boolean;
  /** Стакан и лента идут с неё, а не с общей биржи. */
  book: boolean;
  /** Способы подключения счёта: "oauth" - вход биржей, "keys" - ключи. */
  connect: string[];
  broker: BrokerState;
  /** Справочные ставки, доли единицы. Пусто - не подтверждена. */
  taker: number | null;
  maker: number | null;
  /** Ставка через академию и доля кешбэка. Пусто - условия уточняются. */
  academy_taker: number | null;
  cashback: number | null;
  keys_supported: boolean;
  /** Академия подтвердила счёт ученика на этой бирже - её можно подключать. */
  may_connect?: boolean;
  /** Вход биржей включён на сервере: без брокерского ID кнопка бессмысленна. */
  oauth_ready: boolean;
  connected: boolean;
  /** Сделок терминала, идущих на этой бирже. */
  live?: number;
  key_tail: string;
  auth_kind: string;
  access: string;
  uid: string;
  updated_at: string | null;
  /** Номера счетов, подтверждённые академией. */
  academy_uids: string[];
};

export type VenueListing = {
  /** Биржа, на которую уходят новые сделки. */
  active: string;
  /** Хранилище ключей настроено на сервере. */
  vault: boolean;
  /**
   * Сделок терминала, идущих прямо сейчас - на всех биржах вместе.
   *
   * Пока их больше нуля, активную биржу менять нельзя: следующая заявка ушла
   * бы на другой счёт, а открытая позиция осталась бы на прежнем. Сервер
   * откажет и сам, но кнопку лучше запереть до нажатия.
   */
  live_total?: number;
  venues: VenueRow[];
};

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = getAccessToken();
  if (!token) return null;
  return authReq<T>(path, token, init);
}

export function loadVenues() {
  return req<VenueListing>("/api/exchanges");
}

export function chooseVenue(exchange: string) {
  return req<{ ok: boolean; exchange: string }>("/api/exchanges/active", {
    method: "POST",
    body: JSON.stringify({ exchange }),
  });
}

export function dropVenue(exchange: string) {
  return req<{ ok: boolean }>(`/api/exchanges/${encodeURIComponent(exchange)}`, {
    method: "DELETE",
  });
}

/**
 * Начать вход биржей: сервер отдаёт адрес входа и подписанное состояние.
 *
 * Состояние кладём в хранилище вкладки: биржа вернёт ученика на наш адрес с
 * кодом, и код нужно будет обменять именно с этим состоянием.
 */
export async function startVenueLogin(exchange: string) {
  const body = await req<{ url: string; state: string; expires_in: number }>(
    `/api/exchanges/${encodeURIComponent(exchange)}/oauth/start`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (body?.state) {
    try {
      sessionStorage.setItem(LOGIN_STATE, JSON.stringify({ exchange, state: body.state }));
    } catch {
      // Приватное окно: обмен кода тогда попросит начать заново.
    }
  }
  return body;
}

/** Обменять код биржи на подключённый счёт. */
export function finishVenueLogin(exchange: string, code: string, state: string) {
  return req<{ ok: boolean; exchange: string; key_tail: string; auth_kind: string }>(
    `/api/exchanges/${encodeURIComponent(exchange)}/oauth/finish`,
    { method: "POST", body: JSON.stringify({ code, state }) },
  );
}

const LOGIN_STATE = "nmnh.exchange.login";

/** Начатый вход, если он был: биржа и состояние. */
export function pendingLogin(): { exchange: string; state: string } | null {
  try {
    const raw = sessionStorage.getItem(LOGIN_STATE);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.exchange && saved?.state ? saved : null;
  } catch {
    return null;
  }
}

export function forgetLogin(): void {
  try {
    sessionStorage.removeItem(LOGIN_STATE);
  } catch {
    // Нечего забывать.
  }
}

/** Ставка в процентах: 0.0005 -> «0.05%». Пусто - условия не подтверждены. */
export function ratePct(rate: number | null | undefined): string | null {
  if (rate === null || rate === undefined || !(rate > 0)) return null;
  return `${(rate * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/**
 * Что отвечать про возврат комиссии на этой бирже.
 *
 * Ответов четыре, и путать их нельзя - каждый читается как обещание:
 *
 * * `pays` - возврат есть, доля названа. Тогда же говорим и куда он придёт;
 * * `forbidden` - биржа запрещает партнёрам делиться комиссией (Binance).
 *   Это не «пока не знаем», а «не будет»: ноль пришёл с сервера намеренно;
 * * `unknown` - биржа подключена, а долю партнёрский менеджер ещё не назвал;
 * * `waiting` - биржи в терминале ещё нет, условий по ней и быть не может.
 *
 * Показать «уточняется» вместо «не будет» значит пообещать несуществующее, а
 * наоборот - отнять существующее.
 */
export type CashbackKind = "pays" | "forbidden" | "unknown" | "waiting";

export function cashbackKind(venue: {
  cashback: number | null;
  trading: boolean;
}): CashbackKind {
  if (venue.cashback !== null && venue.cashback > 0) return "pays";
  if (venue.cashback === 0) return "forbidden";
  return venue.trading ? "unknown" : "waiting";
}

/** Доля возврата в процентах: 0.15 -> «15%». Пусто - возврата нет. */
export function cashbackPct(share: number | null | undefined): string | null {
  if (share === null || share === undefined || !(share > 0)) return null;
  return `${Math.round(share * 100)}%`;
}
