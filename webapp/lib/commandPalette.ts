// Палитра символов: что считается вызовом и что показывать (ТЗ этап 5, §8.2).
//
// Счёт и отбор держатся здесь, отдельно от разметки: их проверяют тестом, а не
// глазами. Главное правило - палитра молчит, пока человек печатает. `Ctrl+K`
// в поле ввода принадлежит сообщению в чате, а не нам.

/** Сколько строк показываем: длиннее список не читается, а листать его нечем. */
export const MAX_ROWS = 12;

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** Человек печатает: поле ввода, многострочное поле или редактируемый блок. */
export function isTyping(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Открывать ли палитру по этому нажатию.
 *
 * `Ctrl+K` и `⌘K` - и то, и другое: на маке привычно второе, а браузер на
 * `Ctrl+K` там ничего не делает.
 */
export function opensPalette(
  event: KeyLike,
  target?: TargetLike | null,
): boolean {
  if ((event.key || "").toLowerCase() !== "k") return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.altKey) return false;
  return !isTyping(target);
}

/**
 * Отбор пар по подстроке.
 *
 * Совпадение с начала важнее совпадения в середине: набрав «ETH», человек ждёт
 * `ETHUSDT` первой строкой, а не `ETHFIUSDT`.
 */
export function filterSymbols(
  symbols: string[],
  query: string,
  limit: number = MAX_ROWS,
): string[] {
  const needle = query.trim().toUpperCase();
  if (!needle) return symbols.slice(0, limit);

  const starts: string[] = [];
  const inside: string[] = [];
  for (const symbol of symbols) {
    const at = symbol.indexOf(needle);
    if (at === 0) starts.push(symbol);
    else if (at > 0) inside.push(symbol);
  }
  return [...starts, ...inside].slice(0, limit);
}

/** Куда уедет выделение. Список замкнут в кольцо: снизу возвращаемся наверх. */
export function moveCursor(cursor: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((cursor + delta) % length) + length) % length;
}
