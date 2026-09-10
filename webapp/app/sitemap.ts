import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, absoluteUrl } from "@/lib/seo/site";

/**
 * Карта сайта: список страниц, которые мы сами просим обойти.
 *
 * Сайт - одностраничное приложение со статическим экспортом, и без карты
 * поисковик находит только то, на что наткнулся по ссылкам извне. С картой
 * он получает весь список сразу, в день первой же отправки в Search Console.
 *
 * Дата у всех страниц одна - день сборки. Это честно: страницы собираются
 * вместе, и врозь они не меняются.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
