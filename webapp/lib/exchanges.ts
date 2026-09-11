// Биржи терминала: код и подпись на карточке.
//
// Терминал будет мультибиржевым, и карточка итога подписывается той биржей,
// где сделка открыта: «WEEX Futures» под печатью. Код приходит от сервера - у
// сделки журнала и у ключа счёта. Тот же список держит core/exchanges.py.

export const VENUES: Record<string, string> = {
  weex: "WEEX Futures",
  binance: "Binance Futures",
  okx: "OKX Futures",
  bybit: "Bybit Futures",
  bitget: "Bitget Futures",
};

/** Подпись биржи. Неизвестная или пустая - пусто: карточка без подписи. */
export function venueTitle(code: string | null | undefined): string {
  return VENUES[(code ?? "").trim().toLowerCase()] ?? "";
}
