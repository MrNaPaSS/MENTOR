"use client";

// Выгрузка журнала: отчёт с диаграммами за год сделок.
//
// Инструмент маркета: без покупки на месте кнопки замок, с покупкой - три
// выгрузки в месяц. Счёт держит сервер, а не браузер: лимит, который считает
// сама страница, обходится очисткой хранилища.
//
// Логика вынесена сюда, потому что кнопка теперь в двух местах: в журнале
// терминала и в расширенной аналитике. Отчёт должен быть один и тот же - иначе
// «выгрузка» станет двумя разными файлами с разными числами.

import { useCallback, useEffect, useState } from "react";

import { useEntitlements } from "@/lib/entitlements";
import { useIntlLocale, useT } from "@/lib/i18n";
import { exportJournal, exportQuota, type ExportQuota } from "@/lib/journal";
import { journalReport, saveReport } from "@/lib/journalReport";

export interface JournalExport {
  /** Права уже известны: до этого кнопку не показываем вовсе. */
  loaded: boolean;
  owned: boolean;
  /** Идёт выгрузка: кнопка ждёт ответа сервера. */
  busy: boolean;
  quota: ExportQuota | null;
  /** Выгрузки этого месяца кончились. */
  spent: boolean;
  /** Когда счётчик обнулится, словами. */
  resetDay: string;
  error: string | null;
  /** Собрать отчёт и отдать его файлом. */
  run: (symbol?: string) => Promise<void>;
}

export function useJournalExport(): JournalExport {
  const t = useT();
  const numbers = useIntlLocale();
  const access = useEntitlements();
  const owned = access.has("journal_export");

  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<ExportQuota | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owned) return;
    exportQuota()
      .then((body) => setQuota(body))
      .catch(() => setQuota(null));
  }, [owned]);

  const run = useCallback(
    async (symbol?: string) => {
      setBusy(true);
      setError(null);
      try {
        // За год, а не за период на экране: отчёт берут для разбора целиком.
        // Сделки приходят вместе с засчитанной выгрузкой.
        const body = await exportJournal(symbol);
        if (!body) throw new Error();
        setQuota(body.quota);
        const stamp = new Date().toISOString().slice(0, 10);
        saveReport(
          `nmnh-report-${stamp}.html`,
          journalReport(body.trades, {
            text: t.journal.report,
            quota: { used: body.quota.used, limit: body.quota.limit },
          }),
        );
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : t.journal.exportFailed);
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return {
    loaded: access.loaded,
    owned,
    busy,
    quota,
    spent: quota !== null && quota.left <= 0,
    resetDay: quota
      ? new Date(quota.resets_at).toLocaleDateString(numbers, { day: "numeric", month: "long" })
      : "",
    error,
    run,
  };
}
