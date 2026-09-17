"use client";

// Снимки разбора одной сделки: показать, добавить, убрать.
//
// Окно открывается из строки журнала. Внутри - то, что уже прикреплено, и три
// способа добавить: вставить из буфера (Ctrl+V), перетащить файл, выбрать его
// кнопкой. Вставка первая по важности: снимок экрана в буфере - самый частый
// способ сохранить, как всё выглядело.

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Upload, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import {
  attachShot,
  detachShot,
  pastedImage,
  readImage,
  shotImage,
  shotPage,
  type TradeShot,
} from "@/lib/journalShots";

export interface TradeShotsProps {
  /** Сделка, к которой прикрепляем: тот же опознаватель, что в журнале. */
  clientId: string;
  symbol: string;
  shots: readonly TradeShot[];
  onClose: () => void;
  /** Список изменился: журнал перечитывает строки. */
  onChange: () => void;
}

export default function TradeShots({
  clientId,
  symbol,
  shots,
  onClose,
  onChange,
}: TradeShotsProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = useCallback(
    async (image: string | null) => {
      if (!image) return;
      setBusy(true);
      setError(null);
      try {
        const done = await attachShot(clientId, image);
        if (done) onChange();
        else setError(t.journal.shotFailed);
      } finally {
        setBusy(false);
      }
    },
    [clientId, onChange, t],
  );

  // Вставка из буфера ловится на всём окне, пока оно открыто: целиться курсором
  // в поле ради Ctrl+V - лишний шаг, а другого поля для вставки здесь нет.
  useEffect(() => {
    async function onPaste(event: ClipboardEvent) {
      const image = await pastedImage(event);
      if (image) {
        event.preventDefault();
        void add(image);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [add]);

  // Esc закрывает: окно поверх журнала, и тянуть мышь к крестику незачем.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function drop(files: FileList | null) {
    const file = files?.[0];
    if (file) void add(await readImage(file));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void drop(event.dataTransfer?.files ?? null);
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
            {t.journal.shotsTitle} · {symbol}
          </h2>
          <span className="text-[10px] text-[var(--pane-muted)]">{t.journal.shotsHint}</span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            title={t.journal.close}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-auto p-3">
          {shots.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-[var(--pane-muted)]">
              {t.journal.shotsEmpty}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {shots.map((shot) => (
                <figure
                  key={shot.id}
                  className="group relative overflow-hidden rounded-lg border border-[var(--pane-border)]"
                >
                  {/* Картинка открывается своей страницей: там она во весь
                      экран, и ссылкой на неё делятся. */}
                  <a href={shotPage(shot)} target="_blank" rel="noreferrer">
                    <img
                      src={shotImage(shot)}
                      alt={shot.note || symbol}
                      className="block h-28 w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                  <button
                    onClick={async () => {
                      if (await detachShot(shot.id)) onChange();
                    }}
                    title={t.journal.shotRemove}
                    className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white/70 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {shot.note && (
                    <figcaption className="px-2 py-1 text-[10px] text-[var(--pane-muted)]">
                      {shot.note}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
          {error && <p className="mt-2 text-[11px] text-[var(--pane-down)]">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--pane-border)] px-3 py-2">
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--pane-border)] px-2.5 py-1 text-[11px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-accent)] disabled:opacity-40"
          >
            <Upload className="h-3 w-3" />
            {t.journal.shotAdd}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(event) => {
              void drop(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="text-[10px] text-[var(--pane-muted)]">
            {busy ? t.journal.shotSaving : t.journal.shotPaste}
          </span>
        </div>
      </div>
    </div>
  );
}
