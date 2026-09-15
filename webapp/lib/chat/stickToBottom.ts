/**
 * Стоит ли лента чата у последнего сообщения.
 *
 * Запас в несколько десятков пикселей: прокрутка колесом и тачпадом редко
 * встаёт ровно в ноль, и человека, который смотрит на конец разговора, нельзя
 * считать листающим историю из-за пары пикселей.
 */
export const BOTTOM_SLACK = 80;

export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  slack: number = BOTTOM_SLACK,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
