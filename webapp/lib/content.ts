// Статический контент лендинга (ТЗ §5). Не зависит от API.

export const SOCIAL_LINKS = {
  weexAffiliate: "https://www.weex.com/ru/register?vipCode=kaktotakxme",
  telegram: "https://t.me/+81HEkQveJic2YmEy",
  telegramBot: "https://t.me/nmnh_bot",
  // Бот академии: он же выдаёт одноразовый пароль для входа на сайт. Это не
  // сигнальный бот - у них разные роли и разные записи об учениках.
  academyBot: "https://t.me/moneyhoney7_bot",
  youtube: "https://youtube.com/@nmnh",
  tiktok: "https://tiktok.com/@nmnh",
  threads: "https://threads.net/@nmnh",
};

/**
 * Партнёрская ссылка на регистрацию с учётом языка.
 *
 * У биржи свой раздел на каждый язык, и «/ru/register» открывает англоязычному
 * гостю русскую страницу - на первом же шаге, ещё до академии.
 */
export function weexRegisterUrl(locale: string): string {
  const lang = locale === "en" ? "en" : "ru";
  return `https://www.weex.com/${lang}/register?vipCode=kaktotakxme`;
}

/** Страница пары на бирже - на языке, которым человек пользуется. */
export function weexFuturesUrl(symbol: string, locale: string): string {
  const lang = locale === "en" ? "en" : "ru";
  return `https://www.weex.com/${lang}/futures/${symbol}`;
}

/**
 * Якоря лендинга. Подписи живут в словаре: разделы те же на любом языке,
 * меняется только то, как они названы.
 */
export const NAV_ANCHORS = [
  { key: "about", href: "#about" },
  { key: "terminal", href: "#terminal" },
  { key: "how", href: "#how" },
  { key: "signals", href: "#signals" },
  { key: "results", href: "#results" },
  { key: "faq", href: "#faq" },
] as const;

export type NavAnchorKey = (typeof NAV_ANCHORS)[number]["key"];

/** Шаги «как это работает»: номер и картинка. Текст - в словаре. */
export const HOW_STEPS = [
  { num: "01", icon: "wallet" },
  { num: "02", icon: "bot" },
  { num: "03", icon: "key" },
  { num: "04", icon: "trending" },
] as const;
