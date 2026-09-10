import type { MetadataRoute } from "next";
import { SITE_URL, PRIVATE_PATHS, absoluteUrl } from "@/lib/seo/site";

/**
 * robots.txt - первый файл, который читает поисковик, придя на домен.
 *
 * До сих пор его не было вовсе. Отсутствие файла не запрещает обход, но и не
 * говорит роботу двух вещей, без которых он ходит вслепую: где карта сайта и
 * куда не надо заходить. Из-за второго в выдачу утекали бы страницы кабинета -
 * робот видит их как пустые формы входа.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...PRIVATE_PATHS],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
