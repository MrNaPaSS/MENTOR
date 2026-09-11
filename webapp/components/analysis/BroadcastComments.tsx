"use client";

// Обсуждение под разбором: список комментариев и строка ввода.
//
// Грузится только когда его открыли: под каждой карточкой по списку - это
// десяток запросов ради того, что читают под одним-двумя разборами.

import { useEffect, useState } from "react";
import { Loader2, SendHorizontal, X } from "lucide-react";
import { api, API_URL, type BroadcastComment } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import FramedAvatar from "@/components/avatar/FramedAvatar";

export default function BroadcastComments({
  broadcastId,
  onCount,
}: {
  broadcastId: number;
  /** Сколько комментариев теперь: карточка держит счётчик в своей строке. */
  onCount: (n: number) => void;
}) {
  const t = useT();
  const numbers = intlLocale(useLocale());
  const [list, setList] = useState<BroadcastComment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    let dropped = false;
    api
      .broadcastComments(token, broadcastId)
      .then((rows) => {
        if (dropped) return;
        setList(rows);
        onCount(rows.length);
      })
      .catch(() => !dropped && setList([]));
    return () => {
      dropped = true;
    };
    // onCount - колбэк карточки, список грузим один раз на открытие.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastId]);

  async function send() {
    const token = getAccessToken();
    const body = text.trim();
    if (!token || !body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await api.broadcastComment(token, broadcastId, body);
      const next = [...(list ?? []), row];
      setList(next);
      onCount(next.length);
      setText("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t.signals.social.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    const token = getAccessToken();
    if (!token) return;
    try {
      await api.broadcastCommentDelete(token, broadcastId, id);
      const next = (list ?? []).filter((c) => c.id !== id);
      setList(next);
      onCount(next.length);
    } catch {
      setError(t.signals.social.failed);
    }
  }

  return (
    <div className="animate-fade-in space-y-2 border-t border-[var(--pane-border)] pt-2 motion-reduce:animate-none">
      {list === null ? (
        <div className="h-8 animate-pulse rounded-lg bg-[var(--pane-hover)]" />
      ) : list.length === 0 ? (
        <p className="text-[11px] text-[var(--pane-muted)]">{t.signals.social.empty}</p>
      ) : (
        <ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
          {list.map((c) => (
            <li key={c.id} className="group flex items-start gap-2">
              <FramedAvatar
                src={c.author.avatar ? `${API_URL}${c.author.avatar}` : null}
                name={c.author.name}
                size={22}
                frame={c.author.frame}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`truncate text-[11px] font-semibold ${
                      c.author.mentor ? "text-[var(--pane-gold)]" : "text-[var(--pane-text)]"
                    }`}
                  >
                    {c.author.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--pane-muted)]">
                    {new Date(c.created_at).toLocaleString(numbers, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-[var(--pane-text-2)]">
                  {c.text}
                </p>
              </div>
              {c.mine && (
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  title={t.signals.social.remove}
                  aria-label={t.signals.social.remove}
                  className="shrink-0 text-[var(--pane-muted)] opacity-0 transition-opacity duration-150 hover:text-[var(--pane-down)] group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={800}
          placeholder={t.signals.social.placeholder}
          aria-label={t.signals.social.placeholder}
          className="min-w-0 flex-1 rounded-lg border border-[var(--pane-border)] bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)] focus:border-[var(--pane-gold)]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          title={t.signals.social.send}
          aria-label={t.signals.social.send}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-black transition-[transform,opacity] duration-150 ease-out active:scale-[0.95] disabled:opacity-40"
          style={{ background: "var(--pane-gold)" }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
        </button>
      </form>
      {error && <p className="text-[11px] text-[var(--pane-down)]">{error}</p>}
    </div>
  );
}
