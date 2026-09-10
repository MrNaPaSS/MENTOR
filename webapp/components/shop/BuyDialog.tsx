"use client";

// Подтверждение покупки: что покупаем, за сколько, что останется и как выдадут.

import { useEffect, useState } from "react";
import { Coins, Loader2, X } from "lucide-react";
import type { ShopItem } from "@/lib/api";
import { useIntlLocale, useT } from "@/lib/i18n";
import { NUM, PaneScope } from "@/components/app/Pane";

export default function BuyDialog({
  item,
  balance,
  preview,
  onConfirm,
  onClose,
}: {
  item: ShopItem;
  balance: number;
  /** Что получит покупатель - например, свой аватар в покупаемой рамке. */
  preview?: React.ReactNode;
  /** Отдаёт контакт; бросает ошибку с понятным текстом, если покупка не прошла. */
  onConfirm: (contact: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = !item.feature;
  const needsContact = item.requires_tv;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(contact.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : t.shop.buyError);
      setBusy(false);
    }
  }

  return (
    <PaneScope className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <div
        className="absolute inset-0"
        onClick={() => !busy && onClose()}
        aria-hidden
      />
      <section
        role="dialog"
        aria-label={t.shop.confirmTitle}
        className="relative w-full max-w-sm animate-dialog-in overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--pane-border)] px-4 py-2.5">
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.shop.confirmTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t.common.cancel}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="space-y-3 px-4 py-3">
          {preview && (
            <div className="rounded-lg border border-[var(--pane-border)] bg-[radial-gradient(circle_at_50%_40%,rgba(25,230,140,0.12),transparent_70%)]">
              {preview}
            </div>
          )}
          <p className="text-[12px] text-[var(--pane-text)]">
            <span className="font-semibold">{item.title}</span> {t.shop.confirmFor}{" "}
            <span className={`${NUM} font-semibold`} style={{ color: "var(--pane-gold)" }}>
              {item.price.toLocaleString(numbers)} NMNH
            </span>
          </p>
          <p className="text-[11px] leading-snug text-[var(--pane-muted)]">
            {manual ? t.shop.confirmNote : t.shop.confirmInstant}
          </p>
          <p className="text-[11px] text-[var(--pane-muted)]">
            {t.shop.after((balance - item.price).toLocaleString(numbers))}
          </p>

          {manual && (
            <label className="block">
              <span className="text-[11px] font-semibold text-[var(--pane-muted)]">
                {needsContact ? t.shop.tvLabel : t.shop.contactLabel}
              </span>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={needsContact ? t.shop.tvPlaceholder : "@username"}
                className="mt-1 w-full rounded-md border border-[var(--pane-border)] bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--pane-text)] outline-none focus:border-[var(--pane-gold)]"
              />
              {needsContact && !contact.trim() && (
                <span className="mt-1 block text-[10px] text-[var(--pane-muted)]">{t.shop.tvHint}</span>
              )}
            </label>
          )}

          {error && <p className="text-[11px] text-[var(--pane-down)]">{error}</p>}
        </div>

        <footer className="flex gap-2 border-t border-[var(--pane-border)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-md px-3 py-1.5 text-[12px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || (needsContact && !contact.trim())}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-bold text-black transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--pane-gold)" }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
            {busy ? t.shop.buying : t.shop.buy}
          </button>
        </footer>
      </section>
    </PaneScope>
  );
}
