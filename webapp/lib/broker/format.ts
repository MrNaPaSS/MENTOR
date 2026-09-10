/**
 * Как страница показывает деньги, ставки и обороты.
 *
 * Отдельно от расчётов: считаем везде одинаково, а пишем по-разному. У
 * русского разряды отбиваются пробелом и дробная часть запятой, у английского
 * наоборот, и «0.08%» против «0,08%» - разница, по которой человек понимает,
 * на его ли языке с ним говорят.
 */

/** Деньги без копеек: на витрине копейка ничего не решает, а ширину съедает. */
export function money(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Деньги с копейками - там, где сумма мелкая.
 *
 * Возврат новичка за месяц бывает двадцатью долларами, и «$20» рядом с
 * «$19,60» выглядит округлением в свою пользу. Это витрина про честный счёт,
 * поэтому мелкие суммы показываем как есть.
 */
export function moneyPrecise(value: number, locale: string): string {
  const abs = Math.abs(value);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: abs < 100 ? 2 : 0,
  }).format(value);
}

/**
 * Оборот коротко: $2,8 млн вместо $2 800 000.
 *
 * Длинное число в подписи слайдера ломает строку на телефоне, а в таблице
 * порогов заставляет пересчитывать нули глазами - именно то, чего страница
 * про арифметику себе позволить не может.
 */
export function compactMoney(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "∞";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

/**
 * Ставка комиссии: 0,08%, а не 0,1%.
 *
 * Три знака после запятой обязательны - вся разница между биржами и весь
 * эффект возврата живут в третьем знаке, и округление до сотых стёрло бы
 * ровно то, ради чего таблица нарисована.
 */
export function rate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

/** Доля возврата: целые проценты, дробных здесь не бывает. */
export function share(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}
