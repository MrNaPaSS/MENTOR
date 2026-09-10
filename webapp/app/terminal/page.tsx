import type { Metadata } from "next";
import SeoArticle from "@/components/seo/SeoArticle";
import { terminalPage } from "@/lib/seo/pages/terminal";

/**
 * Страница под запрос «торговый терминал».
 *
 * Сама страница - несколько строк: заголовок для поисковика и вызов общей
 * вёрстки. Текст живёт отдельным файлом, чтобы правка слова не задевала
 * разметку.
 */
export const metadata: Metadata = {
  title: terminalPage.title,
  description: terminalPage.description,
  alternates: { canonical: terminalPage.path },
  openGraph: {
    title: terminalPage.title,
    description: terminalPage.description,
    url: terminalPage.path,
    type: "article",
  },
};

export default function TerminalPage() {
  return <SeoArticle page={terminalPage} />;
}
