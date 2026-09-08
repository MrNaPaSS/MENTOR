"use client";

// Доступ к надписям на языке, который выбрал трейдер.
//
// Словарь - обычный объект, а не поиск по строковому ключу: пропущенный
// перевод тогда ловит компилятор, а не пользователь на экране. Русский
// словарь - источник истины, английский обязан повторять его форму.
//
// Строки с подстановкой - функции: у русского числительные меняются по
// количеству («1 сделка», «2 сделки», «5 сделок»), и никакой шаблон с `%s`
// этого не умеет. Функция умеет.

import { useLocale, readLocale, type Locale } from "./locale";
import { ru } from "./dict/ru";
import { en } from "./dict/en";

export type { Locale };
export { useLocale, readLocale, setLocale, adoptLocale } from "./locale";

/** Форма словаря. Задаётся русским: он полный по определению. */
export type Dict = typeof ru;

const DICTS: Record<Locale, Dict> = { ru, en };

/** Надписи для языка вне React - в модулях звука, журнала и карточки сделки. */
export function dict(locale: Locale = readLocale()): Dict {
  return DICTS[locale] ?? ru;
}

/** Надписи с подпиской на смену языка: страница перерисуется на переключении. */
export function useT(): Dict {
  return DICTS[useLocale()] ?? ru;
}

/**
 * Локаль для `Intl`: числа, даты и разряды.
 *
 * Отдельно от языка интерфейса, потому что не совпадает с ним по имени:
 * `toLocaleString("en")` даст «1,234.56», а «ru» - «1 234,56».
 */
export function intlLocale(locale: Locale = readLocale()): string {
  return locale === "en" ? "en-US" : "ru-RU";
}

/** То же, но с подпиской - для компонентов, которые сами форматируют числа. */
export function useIntlLocale(): string {
  return intlLocale(useLocale());
}
