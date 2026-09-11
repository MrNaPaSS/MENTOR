// Переход между вкладками «Рынка» из самих вкладок.
//
// Баннер Smart Money ведёт на карты. Внутри «Рынка» это смена вкладки -
// событием, страница его слушает. Отдельной страницей Smart Money тоже
// открывается, и тогда это переход внутри приложения, а не перезагрузка:
// перезагрузка обрывает радио и всё, что держит открытый кабинет. Вкладку
// передаём и якорем адреса, и отметкой в сессии - якорь при переходе внутри
// приложения может встать уже после того, как «Рынок» его прочитал.

export const MARKET_SECTION_EVENT = "nmnh:market-section";

/** Вкладка из якоря адреса: «#maps» - карты. Пусто, если якоря нет или он чужой. */
export function sectionFromHash<T extends string>(hash: string, sections: readonly T[]): T | null {
  const key = hash.replace(/^#/, "");
  return (sections as readonly string[]).includes(key) ? (key as T) : null;
}

const PENDING_KEY = "nmnh.market.section";

/** Открыть вкладку «Рынка»: на его странице - событием, с любой другой - переходом. */
export function openMarketSection(section: string, navigate: (url: string) => void): void {
  if (window.location.pathname.startsWith("/app/market")) {
    window.dispatchEvent(new CustomEvent(MARKET_SECTION_EVENT, { detail: section }));
    return;
  }
  try {
    sessionStorage.setItem(PENDING_KEY, section);
  } catch {
    // Без хранилища остаётся якорь адреса.
  }
  navigate(`/app/market#${section}`);
}

/** Вкладка, которую просили открыть переходом. Читается один раз. */
export function takePendingSection(): string {
  try {
    const section = sessionStorage.getItem(PENDING_KEY) ?? "";
    sessionStorage.removeItem(PENDING_KEY);
    return section;
  } catch {
    return "";
  }
}
