"use client";

// План недели формой: заготовку листают, поля заполняют, всё сохраняется само.
//
// Раньше здесь было одно большое пустое поле. План в нём писали один раз - в
// тот день, когда его завели. Форма спрашивает по одному разделу и тем самым
// делает за трейдера самую тяжёлую часть работы: придумывает, о чём вообще
// писать.
//
// Заготовок несколько, они листаются стрелками. Написанное при листании не
// пропадает: разделы чужих заготовок сохраняются вместе с планом и находятся
// на месте, когда заготовку возвращают.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { useT } from "@/lib/i18n";
import {
  PLAN_FORMS,
  buildPlan,
  formById,
  parsePlan,
} from "@/lib/planForms";
import { isoWeek, loadPlan, savePlan } from "@/lib/weekPlan";

export interface PlanFormProps {
  /** Неделя плана: её же показывают цифры под формой. */
  week: string;
  /** Неделя уточнилась по ответу сервера. */
  onWeek: (week: string) => void;
  /** Что рисовать под формой: итог недели. */
  children?: React.ReactNode;
}

export default function PlanForm({ week, onWeek, children }: PlanFormProps) {
  const t = useT();
  const [at, setAt] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Что уже лежит на сервере: по нему видно, есть ли что сохранять.
  const kept = useRef("");
  // Пока план не прочитан, сохранять нечего: иначе пустая форма затрёт
  // написанное на прошлой неделе прежде, чем оно успеет показаться.
  const ready = useRef(false);

  const form = PLAN_FORMS[at];
  const titles = t.journal.planFields as Record<string, string>;
  const hints = t.journal.planHints as Record<string, string>;

  useEffect(() => {
    let gone = false;
    void loadPlan().then((body) => {
      if (gone) return;
      ready.current = true;
      if (!body) return;
      onWeek(body.week);
      kept.current = body.text;
      const seen = parsePlan(body.text);
      setValues(seen.values);
      const found = PLAN_FORMS.findIndex((one) => one.id === seen.form);
      if (found >= 0) setAt(found);
    });
    return () => {
      gone = true;
    };
    // Читаем один раз: неделя приходит из того же ответа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = useMemo(
    () => buildPlan(form, values, titles),
    [form, values, titles],
  );

  // Сохраняем не на каждую букву: план пишут абзацами, и запрос на каждое
  // нажатие клавиши - это десятки запросов на одну мысль.
  useEffect(() => {
    if (!ready.current || text === kept.current) return;
    const id = setTimeout(async () => {
      setBusy(true);
      const done = await savePlan(text, week || isoWeek());
      setBusy(false);
      if (done) {
        kept.current = done.text;
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [text, week]);

  function write(key: string, body: string) {
    setValues((was) => ({ ...was, [key]: body }));
  }

  function flip(step: number) {
    setAt((was) => (was + step + PLAN_FORMS.length) % PLAN_FORMS.length);
  }

  const fields =
    form.id === "free" ? [{ key: "free", sign: "" }] : form.fields;

  return (
    <div className="flex flex-col rounded-lg border border-[var(--pane-border)]">
      <div className="flex items-center gap-1 border-b border-[var(--pane-border)] px-2 py-1.5">
        <button
          onClick={() => flip(-1)}
          title={t.journal.planPrev}
          className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] font-semibold text-[var(--pane-text)]">
          {(t.journal.planForms as Record<string, string>)[form.id]}
        </span>
        <button
          onClick={() => flip(1)}
          title={t.journal.planNext}
          className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-[var(--pane-muted)]">{week}</span>
        <div className="flex-1" />
        {/* Точки заготовок: сколько их всего и которая открыта. Без них
            листание похоже на переключатель с двумя положениями. */}
        <span className="flex items-center gap-1">
          {PLAN_FORMS.map((one, i) => (
            <span
              key={one.id}
              className={`h-1 w-1 rounded-full ${
                i === at ? "bg-[var(--pane-text-2)]" : "bg-[var(--pane-border)]"
              }`}
            />
          ))}
        </span>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--pane-muted)]" />}
        {saved && !busy && <Check className="h-3 w-3 text-[var(--pane-up)]" />}
      </div>

      <div className="grid flex-1 gap-1.5 px-2 py-2">
        {fields.map((one) => (
          <label key={one.key} className="grid gap-0.5">
            <span className="text-[10px] font-medium text-[var(--pane-text-2)]">
              {one.sign && `${one.sign} `}
              {titles[one.key] ?? one.key}
            </span>
            <textarea
              value={values[one.key] ?? ""}
              onChange={(event) => write(one.key, event.target.value)}
              placeholder={hints[one.key] ?? ""}
              spellCheck={false}
              rows={form.id === "free" ? 10 : 2}
              className="resize-none rounded border border-[var(--pane-border)] bg-transparent px-1.5 py-1 text-[11px] leading-relaxed text-[var(--pane-text)] outline-none transition-colors duration-150 ease-out placeholder:text-[var(--pane-muted)] focus:border-[var(--pane-accent-soft)]"
            />
          </label>
        ))}
      </div>

      {children}
    </div>
  );
}
