// Разбор ментора на карточке: направление сделки из текста.
//
// Отдельного поля направления у разбора нет - ментор пишет его словами.
// Берём первое упоминание: «лонг от 0.42, шорт при пробое 0.38» - это лонг,
// а шорт тут запасной сценарий.

export type Direction = "long" | "short";

// \b в JS знает только латиницу, поэтому границы слова - через «не буква».
const LONG = /(^|[^\p{L}])(long|лонг)(?![\p{L}])/iu;
const SHORT = /(^|[^\p{L}])(short|шорт)(?![\p{L}])/iu;

/** Направление разбора по первому упоминанию. Null - ментор его не назвал. */
export function directionOf(text: string | null | undefined): Direction | null {
  if (!text) return null;
  const long = text.search(LONG);
  const short = text.search(SHORT);
  if (long < 0 && short < 0) return null;
  if (long < 0) return "short";
  if (short < 0) return "long";
  return long <= short ? "long" : "short";
}
