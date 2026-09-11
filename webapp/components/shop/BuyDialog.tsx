"use client";

// Подтверждение покупки: что покупаем, за сколько, что останется и как выдадут.
//
// У мерча ещё и выбор: цвет, у одежды размер, - и куда везти. Выбор уходит
// ментору той же строкой контакта, что и адрес: он читает её в уведомлении
// и в админке, и отдельные поля ради этого заводить незачем.

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import CoinIcon from "@/components/app/CoinIcon";
import type { ShopItem } from "@/lib/api";
import { useIntlLocale, useT } from "@/lib/i18n";
import { parseOptions } from "@/lib/shopOptions";
import { CHIP, CHIP_OFF, CHIP_ON, NUM, PaneScope } from "@/components/app/Pane";

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
  const options = parseOptions(item.options);
  const [color, setColor] = useState(options.color[0] ?? "");
  const [size, setSize] = useState(options.size[0] ?? "");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = !item.feature;
  const merch = item.category === "merch";
  const needsTv = item.requires_tv;
  const needsContact = needsTv || merch;
  const ready = !needsContact || contact.trim() !== "";

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
    const choice = [
      color && t.shop.pick.color(color),
      size && t.shop.pick.size(size),
      contact.trim(),
    ]
      .filter(Boolean)
      .join("; ");
    try {
      await onConfirm(choice);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.shop.buyError);
      setBusy(false);
    }
  }

  return (
    <PaneScope className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <div className="absolute inset-0" onClick={() => !busy && onClose()} aria-hidden />
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

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
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
            {!manual ? t.shop.confirmInstant : merch ? t.shop.confirmMerch : t.shop.confirmNote}
          </p>
          <p className="text-[11px] text-[var(--pane-muted)]">
            {t.shop.after((balance - item.price).toLocaleString(numbers))}
          </p>

          {options.color.length > 0 && (
            <Choice label={t.shop.pick.colorLabel} values={options.color} value={color} onPick={setColor} />
          )}
          {options.size.length > 0 && (
            <Choice label={t.shop.pick.sizeLabel} values={options.size} value={size} onPick={setSize} />
          )}

          {manual && (
            <label className="block">
              <span className="text-[11px] font-semibold text-[var(--pane-muted)]">
                {needsTv ? t.shop.tvLabel : merch ? t.shop.pick.addressLabel : t.shop.contactLabel}
              </span>
              {merch ? (
                <textarea
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  rows={3}
                  placeholder={t.shop.pick.addressPlaceholder}
                  className="mt-1 w-full resize-none rounded-md border border-[var(--pane-border)] bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--pane-text)] outline-none focus:border-[var(--pane-gold)]"
                />
              ) : (
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder={needsTv ? t.shop.tvPlaceholder : "@username"}
                  className="mt-1 w-full rounded-md border border-[var(--pane-border)] bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--pane-text)] outline-none focus:border-[var(--pane-gold)]"
                />
              )}
              {needsTv && !contact.trim() && (
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
            disabled={busy || !ready}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-bold text-black transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--pane-gold)" }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CoinIcon size={15} />}
            {busy ? t.shop.buying : t.shop.buy}
          </button>
        </footer>
      </section>
    </PaneScope>
  );
}

function Choice({
  label,
  values,
  value,
  onPick,
}: {
  label: string;
  values: string[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <div>
      <span className="text-[11px] font-semibold text-[var(--pane-muted)]">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {values.map((one) => (
          <button
            key={one}
            type="button"
            onClick={() => onPick(one)}
            className={`${CHIP} border border-[var(--pane-border)] ${value === one ? CHIP_ON : CHIP_OFF}`}
          >
            {one}
          </button>
        ))}
      </div>
    </div>
  );
}
