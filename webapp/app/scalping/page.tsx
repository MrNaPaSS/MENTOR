import type { Metadata } from "next";
import SeoArticle from "@/components/seo/SeoArticle";
import { scalpingPage } from "@/lib/seo/pages/scalping";

/**
 * Страница под запрос «скальпинг криптовалют».
 *
 * Сама страница - несколько строк: заголовок для поисковика и вызов общей
 * вёрстки. Текст живёт отдельным файлом, чтобы правка слова не задевала
 * разметку.
 */
export const metadata: Metadata = {
  title: scalpingPage.title,
  description: scalpingPage.description,
  alternates: { canonical: scalpingPage.path },
  openGraph: {
    title: scalpingPage.title,
    description: scalpingPage.description,
    url: scalpingPage.path,
    type: "article",
  },
};

export default function ScalpingPage() {
  return <SeoArticle page={scalpingPage} />;
}
