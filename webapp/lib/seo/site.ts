/**
 * Адрес сайта и карта его публичных страниц - в одном месте.
 *
 * Тот же адрес уже считает основой метаданные в app/layout.tsx, но robots.txt
 * и sitemap.xml пишут его целиком: поисковику нужен абсолютный URL, иначе он
 * не поймёт, чей это адрес. Держать его в трёх файлах врозь - значит однажды
 * переехать на новый домен и забыть один из них; забытым обычно оказывается
 * sitemap, и Google месяцами ходит по мёртвым ссылкам.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.nmnh.trade";

/** Как часто страница меняется - подсказка обходчику, не приказ. */
type Freq = "daily" | "weekly" | "monthly";

export interface PublicRoute {
  /** Путь от корня, всегда со слэша. */
  path: string;
  /** Вес внутри сайта: 1.0 - главная, дальше по убыванию. */
  priority: number;
  changeFrequency: Freq;
}

/**
 * Страницы, которые пускаем в поиск.
 *
 * Здесь только витрина. Кабинет (/app/*), вход и админка сюда не попадают
 * никогда: за ними личные данные, они требуют входа, а в выдаче выглядели бы
 * пустой страницей с формой - Google такие считает мусором и понижает весь
 * домен.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/broker", priority: 0.9, changeFrequency: "monthly" },
  { path: "/terminal", priority: 0.9, changeFrequency: "monthly" },
  { path: "/scalping", priority: 0.9, changeFrequency: "monthly" },
  { path: "/community", priority: 0.8, changeFrequency: "monthly" },
  { path: "/journal", priority: 0.8, changeFrequency: "monthly" },
  { path: "/calculator", priority: 0.7, changeFrequency: "monthly" },
  { path: "/leaderboard", priority: 0.6, changeFrequency: "daily" },
] as const;

/** Разделы, закрытые от обхода: личный кабинет, вход, админка, загрузки. */
export const PRIVATE_PATHS = ["/app/", "/admin", "/login", "/uploads/"] as const;

/**
 * Полная ссылка на страницу сайта: sitemap и разметка иначе не умеют.
 *
 * У корня хвостовой слэш срезается намеренно. Метаданные Next пишут его в
 * canonical без слэша, и, оставь мы «/» в карте сайта, поисковик получил бы
 * два написания одного адреса и считал бы их разными страницами.
 */
export function absoluteUrl(path: string): string {
  const url = new URL(path, SITE_URL).toString();
  return path === "/" ? url.replace(/\/$/, "") : url;
}
