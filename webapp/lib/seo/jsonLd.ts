/**
 * Разметка Schema.org - то, чем страница объясняет поисковику, что она такое.
 *
 * Обычный текст Google читает как текст: слова, из которых он сам угадывает
 * смысл. Разметка говорит прямо - это организация, это программа, это ответы
 * на вопросы. От неё зависят не позиции сами по себе, а вид строки в выдаче:
 * значок, ссылки на разделы, раскрытые вопросы под ссылкой. Строка, которая
 * занимает вчетверо больше места, собирает вчетверо больше переходов.
 *
 * Каждая функция возвращает готовый объект - вставляет его на страницу
 * components/seo/JsonLd.tsx.
 */
import { SITE_URL, absoluteUrl } from "./site";
import { SOCIAL_LINKS } from "@/lib/content";

/** Узел разметки: свободная форма, её описывает сам schema.org. */
export type JsonLdNode = Record<string, unknown>;

/** Постоянные адреса узлов. Ссылаясь друг на друга, они образуют один граф. */
const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

/**
 * Кто стоит за сайтом.
 *
 * Для финансовой темы это не формальность: Google строже смотрит на сайты про
 * деньги и ищет, кому они принадлежат. Организация без имени и контактов
 * ранжируется хуже той, у которой они есть.
 */
export function organizationLd(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "NMNH",
    alternateName: "No Money No Honey",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icons/icon-512.png"),
      width: 512,
      height: 512,
    },
    description:
      "Торговая академия NMNH: бесплатный терминал для скальпинга криптовалют, сообщество трейдеров и журнал сделок с аналитикой.",
    foundingDate: "2020",
    sameAs: [SOCIAL_LINKS.telegram, SOCIAL_LINKS.youtube, SOCIAL_LINKS.tiktok],
  };
}

/** Сам сайт: имя, язык и то, что он принадлежит организации выше. */
export function webSiteLd(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: SITE_URL,
    name: "NMNH",
    inLanguage: "ru-RU",
    publisher: { "@id": ORG_ID },
  };
}

/**
 * Терминал как программа.
 *
 * Цена указана нулём намеренно: доступ бесплатный, и «0 ₽» в выдаче - самое
 * сильное отличие от платных терминалов, с которыми мы стоим рядом.
 */
export function terminalAppLd(): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    name: "Торговый терминал NMNH",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web, Android, iOS",
    url: absoluteUrl("/terminal"),
    inLanguage: "ru-RU",
    description:
      "Веб-терминал для торговли криптовалютными фьючерсами: биржевой стакан, кластерный анализ, расчёт риска под депозит, стоп и цели на бирже, сопровождение позиции на сервере.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": ORG_ID },
  };
}

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Вопросы и ответы.
 *
 * Разметка обязана повторять то, что человек видит на странице. Если ответ
 * есть в разметке и нет в тексте, Google считает это обманом и снимает
 * оформление со всего сайта - поэтому вопросы берутся из того же словаря,
 * которым нарисован блок FAQ.
 */
export function faqLd(items: readonly FaqItem[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export interface Crumb {
  name: string;
  path: string;
}

/** Хлебные крошки: путь до страницы вместо голого адреса в строке выдачи. */
export function breadcrumbLd(crumbs: readonly Crumb[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** Обычная страница витрины: заголовок, описание и чья она. */
export function webPageLd(params: {
  path: string;
  name: string;
  description: string;
}): JsonLdNode {
  return {
    "@type": "WebPage",
    "@id": `${absoluteUrl(params.path)}#webpage`,
    url: absoluteUrl(params.path),
    name: params.name,
    description: params.description,
    inLanguage: "ru-RU",
    isPartOf: { "@id": SITE_ID },
    publisher: { "@id": ORG_ID },
  };
}
