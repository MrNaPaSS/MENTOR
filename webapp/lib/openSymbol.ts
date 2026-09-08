"use client";

// Просьба открыть монету в терминале.
//
// Приходит она двумя путями, и оба нужны.
//
// Адресом - когда терминал ещё не открыт: с другой страницы кабинета, из
// закладки, из чужого сообщения. Страница читает монету при первом появлении.
//
// Событием - когда терминал уже на экране. Переход по ссылке внутри приложения
// не пересоздаёт страницу: адрес меняется, а состояние остаётся прежним, и
// чтение адреса при появлении здесь не срабатывает вовсе. Именно так нажатие на
// пару в бегущей строке не открывало ничего, если смотреть на терминал.

const EVENT = "nmnh-open-symbol";

/** Монета в адресе выглядит как `?symbol=BTCUSDT`. */
const SHAPE = /^[A-Z0-9]{2,20}$/;

/** Привести к тому виду, в котором монеты живут в терминале, или отказать. */
function clean(value: string | null | undefined): string | null {
  const symbol = (value ?? "").trim().toUpperCase();
  return SHAPE.test(symbol) ? symbol : null;
}

/** Монета из адреса страницы. */
export function symbolFromUrl(): string | null {
  try {
    return clean(new URLSearchParams(window.location.search).get("symbol"));
  } catch {
    // Адреса нет - значит и монеты в нём нет.
    return null;
  }
}

/** Сказать открытому терминалу, что пора показать эту монету. */
export function askSymbol(symbol: string): void {
  const asked = clean(symbol);
  if (!asked) return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: asked }));
  } catch {
    // Событие не ушло - остаётся адрес, по нему монету прочтут при открытии.
  }
}

/** Слушать такие просьбы. Возвращает отписку. */
export function onSymbolAsked(fn: (symbol: string) => void): () => void {
  function handle(event: Event) {
    const asked = clean((event as CustomEvent<string>).detail);
    if (asked) fn(asked);
  }
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
