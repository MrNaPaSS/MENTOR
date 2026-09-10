import type { Metadata } from "next";
import SeoArticle from "@/components/seo/SeoArticle";
import { communityPage } from "@/lib/seo/pages/community";

/**
 * Страница под запрос «сообщество трейдеров».
 *
 * Сама страница - несколько строк: заголовок для поисковика и вызов общей
 * вёрстки. Текст живёт отдельным файлом, чтобы правка слова не задевала
 * разметку.
 */
export const metadata: Metadata = {
  title: communityPage.title,
  description: communityPage.description,
  alternates: { canonical: communityPage.path },
  openGraph: {
    title: communityPage.title,
    description: communityPage.description,
    url: communityPage.path,
    type: "article",
  },
};

export default function CommunityPage() {
  return <SeoArticle page={communityPage} />;
}
