// Заготовки плана недели: не одно пустое поле, а форма с разделами.
//
// Пустое поле - худший способ попросить человека написать план. Трейдер
// открывает его в понедельник, смотрит на белое пятно и закрывает. Форма
// спрашивает по одному: цели, что торгую, по каким правилам, чего не делаю.
// На вопрос отвечают, на пустоту - нет.
//
// Заготовок несколько, и их листают: одному нужен план по инструментам,
// другому - лимиты риска, третьему - работа над привычкой после плохой недели.
// Одну общую форму такие недели не терпят.
//
// Хранится план по-прежнему одной строкой: сервер не знает ни форм, ни полей,
// и менять его ради этого незачем. Разделы узнаются по значку в начале
// заголовка - значок один и тот же на любом языке, поэтому план, написанный
// по-русски, откроется формой и в английском интерфейсе.

/** Раздел плана: ключ для словаря и значок, по которому он узнаётся в тексте. */
export interface PlanField {
  key: string;
  sign: string;
}

export interface PlanForm {
  id: string;
  fields: readonly PlanField[];
}

/**
 * Заготовки по порядку листания.
 *
 * Последняя - свободная: план, написанный своими словами, тоже план, и
 * отбирать эту возможность форма не должна.
 */
export const PLAN_FORMS: readonly PlanForm[] = [
  {
    id: "week",
    fields: [
      { key: "goals", sign: "🎯" },
      { key: "trade", sign: "📌" },
      { key: "rules", sign: "✅" },
      { key: "avoid", sign: "🚫" },
    ],
  },
  {
    id: "risk",
    fields: [
      { key: "risk", sign: "💰" },
      { key: "dayStop", sign: "🛑" },
      { key: "count", sign: "📊" },
      { key: "hours", sign: "⏰" },
    ],
  },
  {
    id: "work",
    fields: [
      { key: "fails", sign: "📉" },
      { key: "repeat", sign: "🔁" },
      { key: "habit", sign: "⭐" },
    ],
  },
  { id: "free", fields: [] },
];

/** Все значки разделов: по ним текст плана разбирается обратно на поля. */
const BY_SIGN = new Map<string, string>(
  PLAN_FORMS.flatMap((form) => form.fields.map((one) => [one.sign, one.key] as const)),
);

export interface PlanParsed {
  /** Какая заготовка узнана. Пусто - свободный текст. */
  form: string;
  /** Что написано в разделах. У свободного плана - ключ `free`. */
  values: Record<string, string>;
}

/**
 * Разобрать сохранённый план на разделы.
 *
 * Строка, начинающаяся со знакомого значка, считается заголовком раздела; всё
 * до следующего заголовка - его содержимым. Текст без единого заголовка
 * остаётся как есть и открывается свободной формой.
 */
export function parsePlan(text: string): PlanParsed {
  const values: Record<string, string> = {};
  let key = "";
  const loose: string[] = [];

  for (const line of text.split("\n")) {
    const sign = [...BY_SIGN.keys()].find((one) => line.trimStart().startsWith(one));
    if (sign) {
      key = BY_SIGN.get(sign) ?? "";
      values[key] = values[key] ?? "";
      continue;
    }
    if (key) {
      values[key] = values[key] === "" ? line : `${values[key]}\n${line}`;
    } else if (line.trim() !== "") {
      loose.push(line);
    }
  }

  for (const one of Object.keys(values)) {
    values[one] = values[one].trim();
  }

  // Какая форма подходит: та, чьих разделов нашлось больше. Ничего не нашлось -
  // план писали руками, и переделывать его под форму мы не вправе.
  const found = Object.keys(values);
  if (found.length === 0) {
    return { form: "free", values: { free: text.trim() } };
  }
  const best = PLAN_FORMS.reduce((top, form) => {
    const hit = form.fields.filter((one) => found.includes(one.key)).length;
    const now = top.fields.filter((one) => found.includes(one.key)).length;
    return hit > now ? form : top;
  }, PLAN_FORMS[0]);

  if (loose.length > 0) values.free = loose.join("\n").trim();
  return { form: best.id, values };
}

/**
 * Собрать план обратно в строку.
 *
 * Пишутся все разделы выбранной формы - даже пустые: каркас плана виден и в
 * тексте, и по нему сразу понятно, чего в плане не хватает. Разделы других
 * форм, если в них что-то написано, дописываются следом: перелистнув
 * заготовку, работу не теряют.
 */
export function buildPlan(
  form: PlanForm,
  values: Record<string, string>,
  titles: Record<string, string>,
): string {
  const parts: string[] = [];

  for (const one of form.fields) {
    parts.push(`${one.sign} ${titles[one.key] ?? one.key}`);
    const body = (values[one.key] ?? "").trim();
    parts.push(body, "");
  }

  const mine = new Set(form.fields.map((one) => one.key));
  for (const other of PLAN_FORMS) {
    for (const one of other.fields) {
      if (mine.has(one.key)) continue;
      const body = (values[one.key] ?? "").trim();
      if (body === "") continue;
      mine.add(one.key);
      parts.push(`${one.sign} ${titles[one.key] ?? one.key}`, body, "");
    }
  }

  const free = (values.free ?? "").trim();
  if (free !== "" && form.id !== "free") parts.push(free, "");
  if (form.id === "free") return free;

  return parts.join("\n").trim();
}

/** Форма по её имени. Незнакомое имя - первая: план недели. */
export function formById(id: string): PlanForm {
  return PLAN_FORMS.find((one) => one.id === id) ?? PLAN_FORMS[0];
}
