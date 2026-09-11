// Текст карточки маркета на языке кабинета.
//
// Товар хранит русский текст - так его заводит ментор - и английский рядом, в
// title_en и description_en. Английского нет - показываем русский: пустая
// карточка хуже непереведённой.

import type { Locale } from "@/lib/i18n";

type Texted = { title: string; description: string; title_en?: string; description_en?: string };

export function itemTitle(item: Texted, locale: Locale): string {
  return locale === "en" && item.title_en ? item.title_en : item.title;
}

export function itemDescription(item: Texted, locale: Locale): string {
  return locale === "en" && item.description_en ? item.description_en : item.description;
}

/**
 * Цвет мерча словами языка кабинета.
 *
 * Варианты заведены ментором по-русски, и в заказ уходит именно его слово -
 * ему потом собирать посылку. Переводится только то, что видит покупатель.
 */
const COLORS_EN: Record<string, string> = {
  "Чёрный": "Black",
  "Черный": "Black",
  "Белый": "White",
  "Серый": "Grey",
  "Красный": "Red",
  "Зелёный": "Green",
  "Зеленый": "Green",
  "Синий": "Blue",
  "Золотой": "Gold",
  "Бежевый": "Beige",
};

export function optionLabel(value: string, locale: Locale): string {
  return locale === "en" ? COLORS_EN[value] ?? value : value;
}
