"use client";

import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { api, StudentOut } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { fmtUsd, maskUid, fmtAgo, fmtDateTime, sourceLabel } from "@/lib/format";

export default function AdminStudents() {
  const token = useMentorToken();
  const [students, setStudents] = useState<StudentOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  function load() {
    api.students(token).then(setStudents).catch(() => setStudents([])).finally(() => setLoaded(true));
  }
  useEffect(load, [token]);

  function replace(s: StudentOut) {
    setStudents((prev) => prev.map((x) => (x.id === s.id ? s : x)));
  }

  async function approve(id: number) {
    setBusy(id);
    try {
      replace(await api.studentApprove(token, id));
    } finally {
      setBusy(null);
    }
  }
  /**
   * Допуск к копированию сделок из чата.
   *
   * Поимённо и по умолчанию закрыт: нажатие «войти» под чужой заявкой ставит
   * настоящую заявку на настоящие деньги, и открывать такое всем разом нельзя.
   */
  /**
   * VIP или обычный.
   *
   * VIP получает все инструменты терминала без покупки: разметку NMNH VISION,
   * объёмные и кластерные свечи, стакан глубже тридцати строк, шаг ×25 и
   * выгрузку журнала. Обычный покупает их в маркете. Снятая отметка оставляет
   * ученику только то, что он купил сам.
   */
  async function toggleVip(s: StudentOut) {
    setBusy(s.id);
    try {
      replace(await api.studentPatch(token, s.id, { is_vip: !s.is_vip }));
    } finally {
      setBusy(null);
    }
  }

  async function toggleCopy(s: StudentOut) {
    setBusy(s.id);
    try {
      replace(await api.studentPatch(token, s.id, { copy_allowed: !s.copy_allowed }));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Право убирать записи из своего журнала.
   *
   * Поимённо и по умолчанию закрыто: журнал - это статистика, по которой судят
   * о торговле, и возможность стереть неудачную сделку обесценивает её целиком.
   * Выдаётся тем, кому доверяют разобрать свой же мусор - двойную запись после
   * обрыва связи, пробную сделку на копейку.
   */
  async function toggleJournal(s: StudentOut) {
    setBusy(s.id);
    try {
      replace(
        await api.studentPatch(token, s.id, {
          journal_delete_allowed: !s.journal_delete_allowed,
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(s: StudentOut) {
    setBusy(s.id);
    try {
      replace(await api.studentPatch(token, s.id, { is_active: !s.is_active }));
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: number) {
    if (!confirm("Удалить ученика?")) return;
    setBusy(id);
    try {
      await api.studentDelete(token, id);
      setStudents((prev) => prev.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  }

  const pending = students.filter((s) => !s.is_approved);

  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-text-primary">Ученики ({students.length})</h1>

      {/* Сводка по входам: сразу видно, до кого платформа ещё не дотянулась. */}
      {loaded && students.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="Заходили в кабинет"
            value={students.filter((s) => s.first_login_at).length}
            total={students.length}
          />
          <SummaryCard
            label="Ни разу не заходили"
            value={students.filter((s) => !s.first_login_at).length}
            total={students.length}
            tone="warn"
          />
          <SummaryCard
            label="Активны за неделю"
            value={students.filter((s) => isRecent(s.last_login_at, 7)).length}
            total={students.length}
            tone="ok"
          />
        </div>
      )}

      {/* Заявки */}
      {pending.length > 0 && (
        <div className="card border-accent-gold/30">
          <h2 className="mb-3 text-lg font-semibold text-accent-gold">Ожидают подтверждения ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-bg-panel px-4 py-2.5">
                {/* Когда заявка появилась и сколько уже висит. Заявка недельной
                    давности и вчерашняя выглядели одинаково, а решают по ним
                    по-разному: человек, который ждёт доступ седьмой день, уже
                    ушёл к кому-то другому. */}
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-medium text-text-primary">@{s.username || s.id}</span>
                  <span className="text-xs text-text-muted" title={fmtDateTime(s.created_at)}>
                    {fmtDateTime(s.created_at)} · {fmtAgo(s.created_at)}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button onClick={() => approve(s.id)} disabled={busy === s.id} className="btn-primary px-3 py-1.5 text-xs">
                    <Check className="h-3.5 w-3.5" /> Принять
                  </button>
                  <button onClick={() => remove(s.id)} disabled={busy === s.id} className="btn-outline px-3 py-1.5 text-xs">
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {!loaded ? (
          <div className="skeleton h-40 w-full" />
        ) : students.length === 0 ? (
          <p className="text-center text-text-muted">Учеников пока нет.</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="py-2">Ник</th>
                <th>UID</th>
                <th className="text-right">Баланс</th>
                <th>Последний вход</th>
                <th className="text-center">Входов</th>
                <th>Источник</th>
                <th className="text-center">Активен</th>
                <th className="text-center">Статус</th>
                <th className="text-center">Копи</th>
                <th className="text-center">Журнал</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="py-2.5 font-medium text-text-primary">@{s.username || s.id}</td>
                  <td className="font-mono text-text-muted">{maskUid(s.weex_uid)}</td>
                  <td className="text-right font-mono">{fmtUsd(s.balance_usdt)}$</td>
                  <td
                    className={s.first_login_at ? "text-text-secondary" : "text-text-muted"}
                    title={
                      s.first_login_at
                        ? `Первый вход: ${fmtDateTime(s.first_login_at)}\nПоследний: ${fmtDateTime(s.last_login_at)}`
                        : "В кабинет ни разу не заходил"
                    }
                  >
                    {s.first_login_at ? fmtAgo(s.last_login_at) : "не заходил"}
                  </td>
                  <td className="text-center font-mono text-text-muted">{s.login_count || 0}</td>
                  <td className="text-text-muted">{sourceLabel(s.created_via)}</td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleActive(s)}
                      disabled={busy === s.id}
                      className={`badge-${s.is_active ? "success" : "muted"}`}
                    >
                      {s.is_active ? "вкл" : "выкл"}
                    </button>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleVip(s)}
                      disabled={busy === s.id}
                      title={
                        s.is_vip
                          ? s.vip_source === "referral"
                            ? "VIP за регистрацию через академию: выдан сам. Снимете - обратно не вернётся"
                            : "VIP: все инструменты терминала открыты без покупки"
                          : "Обычный: инструменты покупает в маркете"
                      }
                      className={`badge-${s.is_vip ? "success" : "muted"}`}
                    >
                      {s.is_vip ? (s.vip_source === "referral" ? "VIP · реф" : "VIP") : "обычный"}
                    </button>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleCopy(s)}
                      disabled={busy === s.id}
                      title={
                        s.copy_allowed
                          ? "Может копировать чужие заявки из чата"
                          : "Копирование заявок из чата закрыто"
                      }
                      className={`badge-${s.copy_allowed ? "success" : "muted"}`}
                    >
                      {s.copy_allowed ? "да" : "нет"}
                    </button>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleJournal(s)}
                      disabled={busy === s.id}
                      title={
                        s.journal_delete_allowed
                          ? "Может убирать свои записи из журнала"
                          : "Записи из журнала убирает только наставник"
                      }
                      className={`badge-${s.journal_delete_allowed ? "success" : "muted"}`}
                    >
                      {s.journal_delete_allowed ? "да" : "нет"}
                    </button>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => remove(s.id)}
                      disabled={busy === s.id}
                      className="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:text-danger"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Был ли вход за последние N дней. */
function isRecent(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  return !Number.isNaN(ts) && Date.now() - ts < days * 86_400_000;
}

function SummaryCard({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone?: "ok" | "warn";
}) {
  const color = tone === "ok" ? "text-success" : tone === "warn" ? "text-accent-gold" : "text-text-primary";
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-bg-panel p-4">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl ${color}`}>{value}</div>
      <div className="mt-0.5 font-mono text-xs text-text-muted">{share}% от всех</div>
    </div>
  );
}
