"use client";

// План на неделю: что торгую и по каким правилам.
//
// Одно поле, свои слова. Заготовки с разделами здесь были и не прижились:
// план у каждого свой, а форма навязывала чужую структуру и отнимала место у
// самого плана.
//
// Сохраняется само, с задержкой: план пишут абзацами, и запрос на каждое
// нажатие клавиши - это десятки запросов на одну мысль.

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { useT } from "@/lib/i18n";
import { isoWeek, loadPlan, savePlan } from "@/lib/weekPlan";

export interface PlanFormProps {
  /** Неделя плана: её же показывают цифры под формой. */
  week: string;
  /** Неделя уточнилась по ответу сервера. */
  onWeek: (week: string) => void;
  /** Что рисовать под планом: итог недели. */
  children?: React.ReactNode;
}

export default function PlanForm({ week, onWeek, children }: PlanFormProps) {
  const t = useT();
  const [plan, setPlan] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Что уже лежит на сервере: по нему видно, есть ли что сохранять.
  const kept = useRef("");
  // Пока план не прочитан, сохранять нечего: иначе пустое поле затрёт
  // написанное прежде, чем оно успеет показаться.
  const ready = useRef(false);

  useEffect(() => {
    let gone = false;
    void loadPlan().then((body) => {
      if (gone) return;
      ready.current = true;
      if (!body) return;
      onWeek(body.week);
      kept.current = body.text;
      setPlan(body.text);
    });
    return () => {
      gone = true;
    };
    // Читаем один раз: неделя приходит из того же ответа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready.current || plan === kept.current) return;
    const id = setTimeout(async () => {
      setBusy(true);
      const done = await savePlan(plan, week || isoWeek());
      setBusy(false);
      if (done) {
        kept.current = done.text;
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [plan, week]);

  return (
    <div className="flex flex-col rounded-lg border border-[var(--pane-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-2 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--pane-text)]">
          {t.journal.planTitle}
        </span>
        <span className="text-[10px] text-[var(--pane-muted)]">{week}</span>
        <div className="flex-1" />
        {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--pane-muted)]" />}
        {saved && !busy && <Check className="h-3 w-3 text-[var(--pane-up)]" />}
      </div>

      <textarea
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
        placeholder={t.journal.planHint}
        spellCheck={false}
        className="min-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[11px] leading-relaxed text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
      />

      {children}
    </div>
  );
}
