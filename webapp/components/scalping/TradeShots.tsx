"use client";

// Снимки разбора одной сделки: показать, полистать, добавить, убрать.
//
// Окно открывается из строки журнала. Внутри - то, что уже прикреплено, и три
// способа добавить: вставить из буфера (Ctrl+V), перетащить файл, выбрать его
// кнопкой. Вставка первая по важности: снимок экрана в буфере - самый частый
// способ сохранить, как всё выглядело.
//
// Снимок открывается здесь же и листается стрелками. Разбор - это сравнение
// «до» и «после», а через переход по ссылке в новую вкладку сравнивать
// нечего: к каждому следующему снимку пришлось бы возвращаться назад.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MoveLeft,
  MoveRight,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import ModalPortal from "@/components/ui/ModalPortal";
import { useT, type Dict } from "@/lib/i18n";
import { money, priceText } from "@/lib/journalFormat";
import {
  attachShot,
  detachShot,
  orderShots,
  pastedImage,
  readImage,
  saveShotNote,
  shotImage,
  shotPage,
  stageOf,
  type TradeShot,
} from "@/lib/journalShots";
import type { JournalRow } from "./JournalTable";

export interface TradeShotsProps {
  /** Сделка, к которой прикрепляем: тот же опознаватель, что в журнале. */
  clientId: string;
  symbol: string;
  shots: readonly TradeShot[];
  /**
   * Сама сделка - ради короткой справки под снимком.
   *
   * Без неё картинка немая: видно свечи, но не видно, какая это была цель и
   * чем кончилось. Подробный разбор живёт в карточке позиции, здесь только
   * то, что относится к этому этапу.
   */
  trade?: JournalRow;
  /**
   * Открыться сразу на этом снимке.
   *
   * Снимки сделки бывают уже показаны там, откуда окно открывают - в дне
   * календаря, например. Показывать их второй раз списком незачем: человек
   * нажал на конкретную картинку и хочет увидеть её крупно.
   */
  openAt?: number;
  onClose: () => void;
  /** Список изменился: журнал перечитывает строки. */
  onChange: () => void;
}

/**
 * Краткая справка под снимком: что в сделке относится к его этапу.
 *
 * Вход - сторона, цена входа и плечо. Ведение - цели, взятые к тому времени.
 * Выход - цена закрытия и итог. Ничего сверх записанного: это подпись к
 * картинке, а не второй журнал.
 */
export function shotBrief(
  shot: TradeShot,
  trade: JournalRow | undefined,
  t: Dict,
): string {
  if (!trade) return "";
  const stage = stageOf(shot.stage, shot.note);

  if (stage === "entry") {
    const side = trade.side === "long" ? t.journal.long : t.journal.short;
    return `${side} · ${priceText(trade.entry)} · ×${trade.leverage}`;
  }

  if (stage === "manage") {
    if (trade.takes_hit === 0) return t.journal.liveNone;
    return trade.targets
      .slice(0, trade.takes_hit)
      .map((price, i) => `TP${i + 1} ${priceText(price)}`)
      .join(" · ");
  }

  const out = trade.exit_price ? priceText(trade.exit_price) : "";
  return [out, money(trade.pnl)].filter(Boolean).join(" · ");
}

export default function TradeShots({
  clientId,
  symbol,
  shots,
  trade,
  openAt,
  onClose,
  onChange,
}: TradeShotsProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  // Файл тащат над окном: рамка светится, чтобы было видно, куда бросать.
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Какой снимок открыт во весь экран. Ноль - тоже снимок, поэтому null.
  const [viewing, setViewing] = useState<number | null>(openAt ?? null);
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

  // Листание: снимки идут по кругу - с последнего вперёд на первый и обратно.
  // Разбор смотрят кругами, и упираться в край списка на каждом проходе
  // раздражает сильнее, чем помогает.
  const flip = useCallback(
    (step: number) => {
      setViewing((now) => {
        if (now === null || shots.length === 0) return now;
        return (now + step + shots.length) % shots.length;
      });
    },
    [shots.length],
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

  // Клавиши: стрелки листают открытый снимок, Esc закрывает сперва его, а уже
  // потом само окно - иначе один Esc уносил бы весь разбор.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (viewing !== null) setViewing(null);
        else onClose();
        return;
      }
      if (viewing === null) return;
      if (event.key === "ArrowLeft") flip(-1);
      if (event.key === "ArrowRight") flip(1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, flip, viewing]);

  // Снимок убрали - открытый мог оказаться за краем списка.
  useEffect(() => {
    setViewing((now) => (now !== null && now >= shots.length ? null : now));
  }, [shots.length]);

  /** Подвинуть снимок на шаг: порядок уезжает на сервер целиком. */
  async function move(index: number, step: number) {
    const to = index + step;
    if (to < 0 || to >= shots.length) return;
    const ids = shots.map((one) => one.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    setError(null);
    if (await orderShots(clientId, ids)) onChange();
    // Молчащая кнопка читается как сломанный экран: сервер может быть старее
    // этой возможности, и сказать об этом надо словами.
    else setError(t.journal.shotOrderFailed);
  }

  async function drop(files: FileList | null) {
    const file = files?.[0];
    if (file) void add(await readImage(file));
  }

  const open = viewing !== null ? shots[viewing] : null;

  return (
    // В общий слой страницы, а не внутрь раздела: окно разбора открывают и из
    // журнала терминала, и поверх окна дня в аналитике. Нарисованное внутри
    // раздела, оно оставалось под ним - на экране была видна половина.
    <ModalPortal>
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void drop(event.dataTransfer?.files ?? null);
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        // Перетаскивание ловим и здесь, а не только на подложке: файл, брошенный
        // на само окно, браузер иначе открывает вкладкой - картинка уезжает
        // вместо того, чтобы прикрепиться.
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOver(false);
          void drop(event.dataTransfer?.files ?? null);
        }}
        className={`flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-[var(--pane-bg)] ${
          over ? "border-[var(--pane-accent)]" : "border-[var(--pane-border)]"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
            {t.journal.shotsTitle} · {symbol}
          </h2>
          <span className="text-[10px] text-[var(--pane-muted)]">
            {open ? `${viewing! + 1} / ${shots.length}` : t.journal.shotsHint}
          </span>
          <div className="flex-1" />
          {open && (
            <>
              {/* Ссылка на страницу снимка остаётся - ею делятся. Но теперь
                  это отдельная кнопка, а не единственный способ посмотреть. */}
              <a
                href={shotPage(open)}
                target="_blank"
                rel="noreferrer"
                title={t.journal.shotOpenPage}
                className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => setViewing(null)}
                title={t.journal.shotBack}
                className="text-[11px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
              >
                {t.journal.shotBack}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            title={t.journal.close}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {open ? (
          // Открытый снимок: сам он по центру, стрелки по краям. Листаются и
          // клавишами - руку с клавиатуры при разборе не убирают.
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/30 p-2">
            <img
              src={shotImage(open)}
              alt={open.note || symbol}
              className="max-h-[70vh] max-w-full object-contain"
            />
            {shots.length > 1 && (
              <>
                <button
                  onClick={() => flip(-1)}
                  title={t.journal.shotPrev}
                  className="absolute left-2 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white/70 transition-colors duration-150 ease-out hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => flip(1)}
                  title={t.journal.shotNext}
                  className="absolute right-2 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white/70 transition-colors duration-150 ease-out hover:text-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            {open.note && (
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white/80">
                {open.note}
              </p>
            )}
          </div>
        ) : (
          <div className="no-scrollbar flex-1 overflow-auto p-3">
            {shots.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-[var(--pane-muted)]">
                {t.journal.shotsEmpty}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {shots.map((shot, i) => (
                  <figure
                    key={shot.id}
                    className="group relative overflow-hidden rounded-lg border border-[var(--pane-border)]"
                  >
                    <button
                      onClick={() => setViewing(i)}
                      title={t.journal.shotOpen}
                      className="block w-full"
                    >
                      <img
                        src={shotImage(shot)}
                        alt={shot.note || symbol}
                        className="block h-28 w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                    <button
                      onClick={async () => {
                        setError(null);
                        if (await detachShot(shot.id)) onChange();
                        else setError(t.journal.shotRemoveFailed);
                      }}
                      title={t.journal.shotRemove}
                      className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white/70 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 hover:text-white"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    {/* Порядок правят кнопками, а не перетаскиванием: в это же
                        окно бросают файлы, и два разных перетаскивания в одной
                        зоне спорили бы друг с другом. */}
                    <div className="absolute bottom-1 left-1 flex gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100">
                      <button
                        disabled={i === 0}
                        onClick={() => void move(i, -1)}
                        title={t.journal.shotLeft}
                        className="rounded bg-black/60 p-1 text-white/70 hover:text-white disabled:opacity-30"
                      >
                        <MoveLeft className="h-3 w-3" />
                      </button>
                      <button
                        disabled={i === shots.length - 1}
                        onClick={() => void move(i, 1)}
                        title={t.journal.shotRight}
                        className="rounded bg-black/60 p-1 text-white/70 hover:text-white disabled:opacity-30"
                      >
                        <MoveRight className="h-3 w-3" />
                      </button>
                    </div>
                    {/* В списке снимок подписан и только. Цифры и поле
                        заметки живут в просмотре: в плитке они съедали саму
                        картинку, ради которой список и открывают. */}
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
        )}

        {/* Цифры снимка идут прямо под ним, отдельной тонкой строкой: сторона
            и цена на входе, взятые цели в ведении, закрытие и итог на выходе. */}
        {open && shotBrief(open, trade, t) && (
          <div className="border-t border-[var(--pane-border)] px-3 py-1 font-mono text-[10px] text-[var(--pane-text-2)]">
            {shotBrief(open, trade, t)}
          </div>
        )}

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

        {/* Заметка своими словами - дело добровольное: снимок по событию
            терминал подписывает сам, и пустое поле здесь ничего не значит. */}
        {open && (
          <textarea
            key={open.id}
            defaultValue={open.note}
            onBlur={async (event) => {
              const body = event.target.value.trim();
              if (body === open.note) return;
              if (await saveShotNote(open.id, body)) onChange();
            }}
            placeholder={t.journal.shotNoteHint}
            rows={2}
            maxLength={140}
            spellCheck={false}
            className="block w-full resize-none border-t border-[var(--pane-border)] bg-transparent px-3 py-1.5 text-[11px] leading-snug text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
          />
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
