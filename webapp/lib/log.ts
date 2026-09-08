"use client";

// Журнал действий терминала: что нажал трейдер и что ответила биржа.
//
// Не для красоты и не для статистики. Терминал - зеркало биржи, и расходятся
// они редко, зато дорого: сделка живёт на графике, когда на бирже её уже нет,
// или наоборот. Разбирать такое по скриншоту нельзя - на нём видно следствие, а
// причина случилась минутой раньше и в другом месте.
//
// Поэтому пишем решения, а не поток данных. «Биржа не показала позицию, второй
// раз подряд - закрываем» стоит одной строки, а четыреста опросов, в которых
// всё было хорошо, не стоят ни одной: в куче шума причину не найти.
//
// Записи переживают перезагрузку: заметив неладное, человек первым делом жмёт
// F5, и память вкладки исчезает вместе с тем, что нужно было прочитать.

const KEY = "nmnh.terminal.log";

// Сколько записей держим. Тысяча решений - это несколько торговых часов; больше
// не влезет в отведённые браузером мегабайты вместе со всем остальным.
const LIMIT = 1000;

export type LogEntry = {
  /** Когда, в миллисекундах. */
  at: number;
  /** Что случилось: короткое имя события, по нему и ищут. */
  kind: string;
  /** Подробности. Пишем только то, что помогает объяснить решение. */
  data?: Record<string, unknown>;
};

let entries: LogEntry[] = [];
let restored = false;

function restore() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) entries = JSON.parse(saved) as LogEntry[];
  } catch {
    // Пустой журнал лучше сломанного экрана.
    entries = [];
  }
}

let flush: ReturnType<typeof setTimeout> | null = null;

function save() {
  // Пишем пачкой: событий бывает несколько подряд, а localStorage синхронный, и
  // запись на каждое из них подтормаживает отрисовку графика.
  if (flush) return;
  flush = setTimeout(() => {
    flush = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      // Место кончилось - режем вдвое и пробуем ещё раз. Свежие записи важнее.
      entries = entries.slice(-Math.floor(LIMIT / 2));
      try {
        localStorage.setItem(KEY, JSON.stringify(entries));
      } catch {
        // Хранилище недоступно вовсе - остаёмся в памяти вкладки.
      }
    }
  }, 400);
}

/** Записать решение или действие. */
export function record(kind: string, data?: Record<string, unknown>): void {
  restore();
  entries.push({ at: Date.now(), kind, data });
  if (entries.length > LIMIT) entries = entries.slice(-LIMIT);
  save();
}

export function all(): LogEntry[] {
  restore();
  return entries;
}

export function clear(): void {
  entries = [];
  restored = true;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Хранилище недоступно - в памяти уже пусто.
  }
}

/**
 * Журнал текстом - таким, каким его можно вставить в переписку.
 *
 * Время в ISO с поясом: разбирать будут не там и не тогда, где записывали, а
 * «16:04» без пояса в этом разборе бесполезно.
 */
export function asText(): string {
  restore();
  const head = [
    `# Журнал терминала NMNH`,
    `# записей: ${entries.length}`,
    `# снято: ${new Date().toISOString()}`,
    `# браузер: ${typeof navigator === "undefined" ? "?" : navigator.userAgent}`,
    "",
  ].join("\n");

  const lines = entries.map((e) => {
    const when = new Date(e.at).toISOString();
    const rest = e.data && Object.keys(e.data).length > 0 ? ` ${JSON.stringify(e.data)}` : "";
    return `${when} ${e.kind}${rest}`;
  });

  return head + lines.join("\n") + "\n";
}

// ── Наблюдение за интерфейсом ──
//
// Решения терминала пишутся поимённо там, где они принимаются. Но половина
// разбора - это «а что вы нажали перед этим», и переспрашивать об этом человека
// бесполезно: он помнит намерение, а не последовательность.
//
// Поэтому нажатия снимаются целиком и сами: один слушатель на документ, подпись
// берётся с самой кнопки. Отдельно инструментировать сотню кнопок ради этого
// пришлось бы вечно, а забыли бы всё равно ту одну, которая понадобится.

/** Что написано на элементе: подсказка, подпись для чтецов или сам текст. */
function label(node: Element): string {
  const title = node.getAttribute("title") || node.getAttribute("aria-label");
  if (title) return title.slice(0, 60);
  const text = (node.textContent || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 60);
}

/** Ближайший элемент, по которому вообще нажимают. */
function target(node: Element | null): Element | null {
  for (let at = node; at; at = at.parentElement) {
    const tag = at.tagName.toLowerCase();
    if (tag === "button" || tag === "a" || tag === "select" || tag === "summary") return at;
    if (at.getAttribute("role") === "button") return at;
    if (tag === "input" && (at as HTMLInputElement).type !== "text") return at;
  }
  return null;
}

/**
 * Включить запись действий. Возвращает отключение.
 *
 * Содержимое полей не пишем никогда - только то, что в них что-то менялось.
 * В них набирают сообщения чата и суммы сделок, и журнал, который потом
 * отправляют в переписку, не должен уносить это с собой.
 */
export function watchUi(): () => void {
  if (typeof document === "undefined") return () => {};

  const onClick = (event: MouseEvent) => {
    const node = target(event.target as Element | null);
    if (!node) return;
    record("ui.click", {
      what: label(node),
      tag: node.tagName.toLowerCase(),
      disabled: (node as HTMLButtonElement).disabled || undefined,
    });
  };

  const onKey = (event: KeyboardEvent) => {
    // Только те клавиши, что сами по себе действие: набор текста в журнал не
    // попадает ни буквой.
    if (!["Enter", "Escape", "Delete"].includes(event.key)) return;
    const node = event.target as Element | null;
    record("ui.key", { key: event.key, on: node ? node.tagName.toLowerCase() : "?" });
  };

  const onError = (event: ErrorEvent) => {
    record("ui.error", { message: event.message, source: `${event.filename}:${event.lineno}` });
  };

  const onReject = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    record("ui.rejected", {
      message: reason instanceof Error ? reason.message : String(reason).slice(0, 200),
    });
  };

  // Захватом: разметка часто гасит всплытие, а нажатие всё равно было.
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onReject);

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onReject);
  };
}
