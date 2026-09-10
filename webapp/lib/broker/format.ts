/**
 * Как страница показывает деньги, ставки и обороты.
 *
 * Отдельно от расчётов: считаем везде одинаково, а пишем по-разному. У
 * русского разряды отбиваются пробелом и дробная часть запятой, у английского
 * наоборот, и «0.08%» против «0,08%» - разница, по которой человек понимает,
 * на его ли языке с ним говорят.
 *
 * Разряды и знаки расставлены руками, без `Intl`, и это не изобретение
 * велосипеда. Страница собирается заранее, в Node, а открывается в браузере,
 * и таблицы форматов у них разные: там, где Node ставит обычный неразрывный
 * пробел, Chrome ставит узкий. Символы невидимые, но для React это другой
 * текст - разметка с сервера не совпадает с той, что он ждёт, гидратация
 * падает целиком, и вместе с ней перестаёт монтироваться всё остальное на
 * странице. Своё форматирование даёт один и тот же символ там и там.
 */
import type { Locale } from "@/lib/i18n/locale";

/** Неразрывный пробел: между числом и знаком строка рваться не должна. */
const NBSP = " ";

/** Разряды: «1 234 567». Разделитель тот же неразрывный пробел. */
function groups(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Целая и дробная части с нужным знаком после запятой или точки. */
function fixed(value: number, decimals: number, locale: Locale): string {
  const sign = value < 0 ? "-" : "";
  const text = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = text.split(".");
  const separator = locale === "en" ? "," : NBSP;
  const point = locale === "en" ? "." : ",";
  const head = groups(whole, separator);
  return fraction ? `${sign}${head}${point}${fraction}` : `${sign}${head}`;
}

/** Доллары так, как их пишет каждый язык: «840 000 $» и «$840,000». */
function withCurrency(text: string, locale: Locale): string {
  if (locale === "en") {
    return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
  }
  return `${text}${NBSP}$`;
}

/** Деньги без копеек: на витрине копейка ничего не решает, а ширину съедает. */
export function money(value: number, locale: Locale): string {
  return withCurrency(fixed(value, 0, locale), locale);
}

/**
 * Деньги с копейками - там, где сумма мелкая.
 *
 * Возврат новичка за месяц бывает двадцатью долларами, и «$20» рядом с
 * «$19,60» выглядит округлением в свою пользу. Это витрина про честный счёт,
 * поэтому мелкие суммы показываем как есть.
 */
export function moneyPrecise(value: number, locale: Locale): string {
  const decimals = Math.abs(value) < 100 ? 2 : 0;
  return withCurrency(fixed(value, decimals, locale), locale);
}

/** Сокращения разрядов: у каждого языка свои. */
const UNITS: Record<Locale, readonly { from: number; suffix: string }[]> = {
  ru: [
    { from: 1_000_000_000, suffix: `${NBSP}млрд` },
    { from: 1_000_000, suffix: `${NBSP}млн` },
    { from: 1_000, suffix: `${NBSP}тыс.` },
  ],
  en: [
    { from: 1_000_000_000, suffix: "B" },
    { from: 1_000_000, suffix: "M" },
    { from: 1_000, suffix: "K" },
  ],
};

/**
 * Оборот коротко: «2,8 млн $» вместо «2 800 000 $».
 *
 * Длинное число в подписи слайдера ломает строку на телефоне, а в таблице
 * порогов заставляет пересчитывать нули глазами - именно то, чего страница
 * про арифметику себе позволить не может.
 */
export function compactMoney(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "∞";

  const abs = Math.abs(value);
  const unit = UNITS[locale].find((u) => abs >= u.from);
  if (!unit) return money(value, locale);

  const scaled = value / unit.from;
  // Дробная часть только у миллионов и выше: «47,4 тыс.» - точность, которой
  // в разговоре об обороте никто не пользуется.
  const decimals = abs >= 1_000_000 && Math.abs(scaled) < 100 ? 1 : 0;
  const text = fixed(scaled, decimals, locale).replace(/[.,]0$/, "");
  return withCurrency(`${text}${unit.suffix}`, locale);
}

/**
 * Ставка комиссии: 0,08%, а не 0,1%.
 *
 * Три знака после запятой обязательны - вся разница между биржами и весь
 * эффект возврата живут в третьем знаке, и округление до сотых стёрло бы
 * ровно то, ради чего таблица нарисована.
 */
export function rate(value: number, locale: Locale): string {
  return percent(value * 100, 3, locale);
}

/** Доля возврата: целые проценты, дробных здесь не бывает. */
export function share(value: number, locale: Locale): string {
  return percent(value * 100, 0, locale);
}

function percent(value: number, decimals: number, locale: Locale): string {
  const text = fixed(value, decimals, locale);
  return locale === "en" ? `${text}%` : `${text}${NBSP}%`;
}
