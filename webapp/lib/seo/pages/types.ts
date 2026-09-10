import type { FaqItem } from "@/lib/seo/jsonLd";

/** Смысловой блок страницы: заголовок второго уровня и текст под ним. */
export interface SeoSection {
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
}

/** Ссылка на соседнюю страницу витрины. */
export interface SeoLink {
  path: string;
  label: string;
  hint: string;
}

/**
 * Страница витрины, написанная под поисковый запрос.
 *
 * Текст отделён от вёрстки намеренно: страниц четыре, устроены они одинаково,
 * и правится в них обычно слово, а не разметка. Держа слова отдельно, их можно
 * менять, не трогая ни одного тега - и не ломая то, что уже нашёл поисковик.
 */
export interface SeoPage {
  /** Путь от корня; он же уходит в canonical, sitemap и хлебные крошки. */
  path: string;
  /** Строка в выдаче. До 60 знаков - дальше Google обрезает многоточием. */
  title: string;
  /** Описание под строкой выдачи. До 160 знаков по той же причине. */
  description: string;
  /** Надпись над заголовком: раздел, к которому страница относится. */
  eyebrow: string;
  /** Единственный H1 страницы. */
  h1: string;
  /** Первый абзац: он же чаще всего попадает в сниппет выдачи. */
  lead: string;
  sections: readonly SeoSection[];
  faq: readonly FaqItem[];
  cta: { heading: string; text: string };
  /** Соседние страницы: обход сайта идёт по ссылкам, а не по угадыванию. */
  related: readonly SeoLink[];
}
