// Переход между вкладками «Рынка» из самих вкладок.
//
// Баннер Smart Money ведёт на карты. Внутри «Рынка» это смена вкладки -
// событием, страница его слушает. Отдельной страницей Smart Money тоже
// открывается, и тогда вкладку передаём якорем адреса: «Рынок» читает его
// при открытии.

export const MARKET_SECTION_EVENT = "nmnh:market-section";

/** Вкладка из якоря адреса: «#maps» - карты. Пусто, если якоря нет или он чужой. */
export function sectionFromHash<T extends string>(hash: string, sections: readonly T[]): T | null {
  const key = hash.replace(/^#/, "");
  return (sections as readonly string[]).includes(key) ? (key as T) : null;
}

/** Открыть вкладку «Рынка»: на его странице - событием, с любой другой - переходом. */
export function openMarketSection(section: string): void {
  if (window.location.pathname.startsWith("/app/market")) {
    window.dispatchEvent(new CustomEvent(MARKET_SECTION_EVENT, { detail: section }));
    return;
  }
  window.location.href = `/app/market#${section}`;
}
