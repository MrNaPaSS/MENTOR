import type { Metadata } from "next";
import SeoArticle from "@/components/seo/SeoArticle";
import { journalPage } from "@/lib/seo/pages/journal";

/**
 * Страница под запрос «журнал сделок».
 *
 * Сама страница - несколько строк: заголовок для поисковика и вызов общей
 * вёрстки. Текст живёт отдельным файлом, чтобы правка слова не задевала
 * разметку.
 */
export const metadata: Metadata = {
  title: journalPage.title,
  description: journalPage.description,
  alternates: { canonical: journalPage.path },
  openGraph: {
    title: journalPage.title,
    description: journalPage.description,
    url: journalPage.path,
    type: "article",
  },
};

export default function JournalPage() {
  return <SeoArticle page={journalPage} />;
}
