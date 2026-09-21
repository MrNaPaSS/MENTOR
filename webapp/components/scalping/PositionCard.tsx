"use client";

// Позиция целиком: цифры сделки, снимки по этапам и разбор словами.
//
// Это то, ради чего журнал ведут. Строка списка отвечает «сколько», а здесь
// видно «как»: где был вход и стоп, во сколько раз риск меньше цели, в какую
// сессию торговали, что происходило на графике до входа, на входе, в ведении
// и на выходе, и что об этом думает сам трейдер.
//
// Снимки раскладываются по этапам сами - тот, что сделал терминал, знает свой
// этап, - а руками добавляются «до входа» и «разбор».

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Share2, X } from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { money, priceText, tone } from "@/lib/journalFormat";
import {
  STAGES,
  attachShot,
  pastedImage,
  readImage,
  saveReview,
  stageOf,
  shotImage,
  type ShotStage,
  type TradeShot,
} from "@/lib/journalShots";
import ModalPortal from "@/components/ui/ModalPortal";
import { heldLabel, heldSeconds } from "@/lib/tradeTime";
import PnlCard from "./PnlCard";
import TradeShots from "./TradeShots";
import { cardFromTrade } from "@/lib/pnl/data";
import type { JournalRow } from "./JournalTable";

export interface PositionCardProps {
  trade: JournalRow;
  /** Номер позиции в неделе: по нему её и называют в разговоре. */
  number?: number;
  onClose: () => void;
  /** Что-то изменилось: журнал перечитывает строки. */
  onChange: () => void;
  /** Имя владельца для подписи на карточке сделки. Пусто - без подписи. */
  owner?: string;
}

/** Торговая сессия по часу входа: по ней видно, где результат лучше. */
export function sessionOf(at: string | null): "asia" | "london" | "newYork" | "evening" {
  const hour = at ? new Date(at).getUTCHours() : 0;
  if (hour < 7) return "asia";
  if (hour < 12) return "london";
  if (hour < 17) return "newYork";
  return "evening";
}

/** Во сколько раз задуманная цель дальше стопа. Ноль - считать не из чего. */
export function riskReward(trade: {
  entry: number;
  stop: number;
  targets: number[];
}): number {
  const risk = Math.abs(trade.entry - trade.stop);
  const far = trade.targets.at(-1);
  if (!(risk > 0) || far === undefined) return 0;
  return Math.abs(far - trade.entry) / risk;
}

export default function PositionCard({
  trade,
  number,
  onClose,
  onChange,
  owner,
}: PositionCardProps) {
  const t = useT();
  const numbers = useIntlLocale();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState(trade.review ?? "");
  const [stage, setStage] = useState<ShotStage>("entry");
  // Открытый снимок: окно со всеми картинками сделки, начиная с нажатой.
  const [viewAt, setViewAt] = useState<number | null>(null);
  // Открыта ли карточка сделки - та самая картинка, которой делятся.
  const [card, setCard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const kept = useRef(trade.review ?? "");

  // Разбор сохраняется сам, через паузу: его пишут абзацами, и запрос на
  // каждую клавишу - это десятки запросов на одну мысль.
  useEffect(() => {
    if (review === kept.current) return;
    const id = setTimeout(async () => {
      setBusy(true);
      const done = await saveReview(trade.client_id, { review });
      setBusy(false);
      if (done) {
        kept.current = review;
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        onChange();
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [review, trade.client_id, onChange]);

  // Вставка из буфера кладёт снимок в выбранный сейчас этап.
  useEffect(() => {
    async function onPaste(event: ClipboardEvent) {
      const image = await pastedImage(event);
      if (!image) return;
      event.preventDefault();
      await add(image);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trade.client_id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function add(image: string | null) {
    if (!image) return;
    setBusy(true);
    const done = await attachShot(trade.client_id, image, "", stage);
    setBusy(false);
    if (done) onChange();
  }

  const rr = riskReward(trade);
  const shots = trade.shots ?? [];
  const at = trade.closed_at ?? trade.opened_at ?? null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-modal grid place-items-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={async (event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (file) await add(await readImage(file));
          }}
          className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
            <span className="font-mono text-[12px] font-bold text-[var(--pane-text)]">
              {trade.symbol.replace(/USDT$/, "")}
            </span>
            <span
              className={`text-[11px] ${
                trade.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
              }`}
            >
              {trade.side === "long" ? t.journal.long : t.journal.short}
            </span>
            {number !== undefined && (
              <span className="text-[10px] text-[var(--pane-muted)]">
                {t.journal.positionNo(number)}
              </span>
            )}
            <span className="text-[10px] text-[var(--pane-muted)]">
              {at
                ? new Date(at).toLocaleString(numbers, {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </span>
            <div className="flex-1" />
            {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--pane-muted)]" />}
            {saved && !busy && <Check className="h-3 w-3 text-[var(--pane-up)]" />}
            <span className={`font-mono text-[13px] font-bold ${tone(trade.pnl)}`}>
              {money(trade.pnl)}
            </span>
            {/* Карточка сделки - рядом с итогом: делятся именно им, и рука
                идёт туда же, куда взгляд. */}
            <button
              onClick={() => setCard(true)}
              title={t.journal.cardTitle}
              className="ml-1 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              title={t.journal.close}
              className="ml-1 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="no-scrollbar flex-1 overflow-auto p-3">
            {/* Три этапа в один ряд, каждый - одной стопкой.
                Лесенкой из рядов по четыре плитки карточка растягивалась на
                два экрана, и две трети её были пустым полем: снимков на этап
                обычно один-два. Стопка отвечает тем же: вот вход, вот ведение,
                вот выход, а сколько там картинок - написано на ней. */}
            <div className="grid grid-cols-3 gap-2">
              {STAGES.map((one) => {
                const mine = shots.filter((shot) => stageOf(shot.stage, shot.note) === one);
                const cover = mine[0];
                // Номер первого снимка этапа в общем списке: окно снимков
                // откроется сразу на нём, а не на первой картинке сделки.
                const at = cover ? shots.findIndex((shot) => shot.id === cover.id) : -1;
                return (
                  <div key={one}>
                    <div className="mb-1 flex items-baseline gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pane-text-2)]">
                        {t.journal.stages[one]}
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={() => {
                          setStage(one);
                          fileRef.current?.click();
                        }}
                        title={t.journal.stageAdd}
                        className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {mine.length === 0 ? (
                      <button
                        onClick={() => {
                          setStage(one);
                          fileRef.current?.click();
                        }}
                        className="flex aspect-[4/3] w-full items-center justify-center rounded border border-dashed border-[var(--pane-border)] text-center text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-text-2)]"
                      >
                        {t.journal.stageEmpty}
                      </button>
                    ) : (
                      <button
                        onClick={() => setViewAt(at < 0 ? 0 : at)}
                        className="group relative block w-full text-left"
                      >
                        {/* Стопка: под верхним снимком видны края нижних -
                            столько же, сколько их есть, но не больше двух. */}
                        {mine.length > 2 && (
                          <span className="absolute inset-x-2 -top-1 h-2 rounded-t border border-b-0 border-[var(--pane-border)] bg-[var(--pane-hover)]" />
                        )}
                        {mine.length > 1 && (
                          <span className="absolute inset-x-1 -top-0.5 h-2 rounded-t border border-b-0 border-[var(--pane-border)] bg-[var(--pane-bg)]" />
                        )}
                        <span className="relative block overflow-hidden rounded border border-[var(--pane-border)] transition-colors duration-150 ease-out group-hover:border-[var(--pane-accent-soft)]">
                          <img
                            src={shotImage(cover)}
                            alt={cover.note || trade.symbol}
                            className="block aspect-[4/3] w-full object-cover transition duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            loading="lazy"
                          />
                          {mine.length > 1 && (
                            <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white/80">
                              {mine.length}
                            </span>
                          )}
                        </span>
                        {/* Подпись стопки. У ведения это взятые цели - все,
                            какие есть: «цель 1 · цель 2». Одна подпись первого
                            снимка врала бы о второй и третьей. */}
                        <span className="mt-0.5 block truncate text-[9px] text-[var(--pane-muted)]">
                          {one === "manage" && trade.takes_hit > 0
                            ? Array.from({ length: trade.takes_hit }, (_, i) =>
                                t.terminal.autoShotTake(i + 1),
                              ).join(" · ")
                            : cover.note || t.journal.stageWhat[one]}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Цифры сделки под снимками: разбор начинают с картинки - что было
                видно на графике, - и только потом сверяются с числами. Сверху
                они отодвигали снимки за край экрана. */}
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-4">
              {/* Три ровных ряда по четыре. Первый - цены замысла и выход,
                  второй - чем входили, третий - цели и время в сделке. Цели
                  начинают нижний ряд: их читают последними, сверяя с выходом. */}
              <Fact label={t.journal.colEntry} value={priceText(trade.entry)} />
              <Fact label={t.journal.cardStop} value={priceText(trade.stop)} />
              <Fact
                label={t.journal.cardExit}
                value={trade.exit_price ? priceText(trade.exit_price) : "-"}
              />
              <Fact
                label={t.journal.cardRR}
                value={rr > 0 ? `1 : ${rr.toFixed(1)}` : "-"}
              />

              <Fact label={t.journal.cardQty} value={String(trade.qty)} />
              <Fact label={t.journal.cardLeverage} value={`×${trade.leverage}`} />
              <Fact
                label={t.journal.cardSession}
                value={t.journal.sessions[sessionOf(trade.opened_at)]}
              />
              <Fact
                label={t.journal.cardFee}
                value={trade.fee > 0 ? `-${trade.fee.toFixed(2)}` : "-"}
              />

              {/* Взятая цель отмечена цветом. */}
              {trade.targets.slice(0, 3).map((price, i) => (
                <Fact
                  key={i}
                  label={`TP${i + 1}`}
                  value={priceText(price)}
                  tone={i < trade.takes_hit ? "text-[var(--pane-up)]" : undefined}
                />
              ))}
              {/* Целей меньше трёх - пустые места держат ряд: без них время в
                  сделке уезжает в середину строки. */}
              {Array.from({ length: Math.max(0, 3 - trade.targets.length) }, (_, i) => (
                <span key={`gap-${i}`} className="hidden sm:block" />
              ))}
              {/* Время в сделке: у идущей оно набегает, и подпись говорит об
                  этом прямо - иначе цифра выглядит окончательной. */}
              <Fact
                label={trade.closed_at ? t.journal.cardHeld : t.journal.cardHeldLive}
                value={heldLabel(heldSeconds(trade), t.journal.heldUnits)}
              />
            </div>

            {/* Заметка в одну строку: её и пишут одной строкой, а поле
                высотой в абзац обещало сочинение. Подпись - в самом поле:
                заголовок над ним занимал столько же места, сколько заметка. */}
            <textarea
              value={review}
              onChange={(event) => setReview(event.target.value)}
              placeholder={t.journal.reviewPlace}
              spellCheck={false}
              rows={1}
              className="mt-2 w-full resize-none rounded border border-[var(--pane-border)] bg-transparent px-2 py-1 text-[11px] leading-relaxed text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
            />
          </div>
        </div>
      </div>

      {card && (
        <PnlCard data={cardFromTrade(trade, owner)} onClose={() => setCard(false)} />
      )}

      {/* Окно снимков открывается по стопке этапа и сразу на ней: листать
          картинки удобнее во весь экран, а не в плитке величиной с марку. */}
      {viewAt !== null && (
        <TradeShots
          clientId={trade.client_id}
          symbol={trade.symbol}
          shots={shots}
          trade={trade}
          openAt={viewAt}
          onClose={() => setViewAt(null)}
          onChange={onChange}
        />
      )}
    </ModalPortal>
  );
}

function Fact({
  label,
  value,
  tone: colour,
}: {
  label: string;
  value: string;
  /** Класс цвета. Пусто - обычная цифра: подсвечивают только взятые цели. */
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--pane-border)] pb-0.5">
      <span className="text-[10px] font-sans text-[var(--pane-muted)]">{label}</span>
      <span className={`truncate ${colour ?? "text-[var(--pane-text-2)]"}`}>{value}</span>
    </div>
  );
}

