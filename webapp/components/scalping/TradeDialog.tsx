"use client";

// Окно расчёта сделки от полки ликвидности.
//
// Открывается по нажатию на полку — на графике или в стакане. Сторона не
// спрашивается: полка в заявках на покупку это поддержка, значит лонг, полка в
// продажах — сопротивление, значит шорт. Спрашивать у трейдера то, что уже
// известно из стакана, значит давать ему возможность ошибиться.
//
// Готовые значения стоят под полями строкой, а не выпадающим списком: список
// перекрывал сам расчёт, ради которого окно и открыто. Цифры и кнопки видны
// одновременно — трейдер меняет плечо и сразу видит, что стало с риском.
//
// «Войти» не отправляет ордер на биржу: сделка начинает ждать свою цену, а
// разметка остаётся на графике.

import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { money, price as fmtPrice, type Wall } from "@/lib/scalping";
import { computeTrade, sideForShelf, DEFAULT_TAKES } from "@/lib/trade/plan";
import { TAKER_FEE } from "@/lib/trade/position";

export type TradeDraft = {
  shelf: Wall;
  tick: number;
  margin: number;
  leverage: number;
  stopPct: number;
};

// Частые значения под пальцем: скальпер работает одними и теми же суммами, и
// набирать «50» с клавиатуры двадцать раз за сессию — потерянное время.
const MARGINS = [10, 25, 50, 100, 250, 500];

// Тысяча стоит отдельно: на монете с низким потолком заявки она не пройдёт, и
// показывать кнопку, которая приведёт к отказу биржи, - значит ставить ловушку.
const BIG_MARGIN = 1000;

const LEVERAGES = [10, 25, 50, 100, 200, 400];

// Шаг стопа мельче у ближних значений и крупнее у дальних. Скальпер живёт в
// диапазоне до трёх десятых процента, и там ему нужен выбор; дальше стоп ставят
// редко, и лишние кнопки только удлиняют ряд.
const STOPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1, 1.5];

const FIELD =
  "w-full rounded-md border border-[var(--pane-border)] bg-[var(--pane-deep)] px-2.5 py-2 text-right font-mono text-[15px] " +
  "text-[var(--pane-text)] outline-none transition-colors duration-150 ease-out focus:border-[var(--pane-accent-soft)]";

const CHIP =
  "rounded px-1.5 py-0.5 font-mono text-[11px] transition-[background-color,color,transform] " +
  "duration-150 ease-out active:scale-[0.97]";

const BUTTON =
  "rounded-md px-4 py-2 text-[12px] font-semibold transition-[background-color,transform] " +
  "duration-150 ease-out active:scale-[0.98]";

export default function TradeDialog({
  draft,
  onChange,
  onConfirm,
  onCancel,
  live = false,
  maxLeverage,
  takerFee,
  maxQty,
  maxPosition,
  opposing = 0,
}: {
  draft: TradeDraft;
  onChange: (next: TradeDraft) => void;
  /** Расчёт принят: окно закрывается, разметка остаётся на графике. */
  onConfirm: () => void;
  /** Отказ: сделка снимается с графика целиком. */
  onCancel: () => void;
  /** Счёт подключён: подтверждение отправит заявку на биржу. */
  live?: boolean;
  /**
   * Потолок плеча по этой монете.
   *
   * У большинства монет биржи он ×20 или ×50, а готовые значения доходят до
   * ×400. Кнопка, которая гарантированно приведёт к отказу биржи, - это не
   * выбор, а ловушка: такие мы не показываем.
   */
  maxLeverage?: number;
  /** Комиссия тейкера этой монеты: по ней считаются подсказки в окне. */
  takerFee?: number;
  /**
   * Потолок одной заявки по монете и потолок всей позиции, в самой монете.
   *
   * Нужны кнопке крупной суммы: на дешёвой монете тысяча долларов с плечом
   * упирается в этот потолок, и биржа откажет.
   */
  maxQty?: number;
  maxPosition?: number;
  /**
   * Объём встречной позиции по этой монете.
   *
   * На одностороннем счёте ордер против открытой позиции уменьшает её, а не
   * заводит вторую сделку: трейдер думает, что открыл шорт, а на деле закрыл
   * свой лонг. Знать это нужно до нажатия.
   */
  opposing?: number;
}) {
  // Сумму не выделяем и не забираем на неё курсор: она приходит из прошлой
  // сделки и чаще всего верна. Выделенное число исчезает от первого же
  // нажатия, и трейдер, поправлявший плечо, терял сумму, которую не трогал.

  // Горячие клавиши: обработчики держим в ref, чтобы подписка не зависела от
  // того, как часто перерисовывается страница под окном.
  const keys = useRef({ onCancel, onConfirm });
  keys.current = { onCancel, onConfirm };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Только Esc. Enter раньше отправлял заявку на биржу - и отправлял её
      // в тот момент, когда трейдер заканчивал набор числа в поле. Ордер на
      // деньги должен уходить по нажатию на кнопку, названную словом.
      if (event.key === "Escape") keys.current.onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Готовые плечи выше потолка монеты не показываем, а сам потолок добавляем:
  // трейдер должен видеть, куда упирается, и уметь встать ровно туда.
  const cap = maxLeverage && maxLeverage > 0 ? maxLeverage : null;
  const leverages = cap
    ? [...LEVERAGES.filter((l) => l < cap), cap].filter((l, i, all) => all.indexOf(l) === i)
    : LEVERAGES;
  const overLimit = cap !== null && draft.leverage > cap;

  // Крупная сумма - только если она пройдёт на этой монете. Считаем так же, как
  // считает сам расчёт сделки: объём есть сумма на плечо, делённая на цену.
  //
  // Потолка биржа называет два, и меньший из них и есть настоящий предел. Не
  // назвала ни одного - показываем: запрещать по незнанию хуже, чем показать
  // кнопку, на которую в редком случае ответит отказом биржа.
  const margins = useMemo(() => {
    const price = draft.shelf.price;
    if (!(price > 0)) return MARGINS;

    const caps = [maxQty, maxPosition].filter((v): v is number => Boolean(v && v > 0));
    if (caps.length === 0) return [...MARGINS, BIG_MARGIN];

    const qty = (BIG_MARGIN * draft.leverage) / price;
    return qty <= Math.min(...caps) ? [...MARGINS, BIG_MARGIN] : MARGINS;
  }, [draft.shelf.price, draft.leverage, maxQty, maxPosition]);

  // Плечо выше потолка монеты подводим к потолку, как только его узнали.
  // Вниз и только вниз: поднимать плечо за трейдера нельзя, это его риск.
  useEffect(() => {
    if (cap !== null && draft.leverage > cap) onChange({ ...draft, leverage: cap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap, draft.leverage]);

  const t = useT();
  const d = t.dialogs.trade;

  /**
   * Куда трейдер отодвинул окно.
   *
   * Расчёт закрывает середину экрана - ровно то место, где стоит цена, от
   * которой его открыли. Трейдер правит сумму и стоп, глядя на график, а
   * график в этот момент под окном. Сдвинуть его - единственный способ видеть
   * оба; поэтому окно держится не на месте, а там, куда его увели.
   *
   * Смещение живёт до закрытия: следующий расчёт снова открывается по центру.
   * Запоминать место надолго нечего - оно зависит от того, где сегодня стоит
   * цена, а не от привычки.
   */
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const grab = useRef<{ x: number; y: number } | null>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    // Тянут за шапку, но не за крестик: нажатие на него закрывает окно, и
    // перехватывать его указатель нельзя.
    if ((event.target as HTMLElement).closest("button")) return;
    grab.current = { x: event.clientX - shift.x, y: event.clientY - shift.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDrag(event: React.PointerEvent<HTMLDivElement>) {
    const from = grab.current;
    if (!from) return;
    setShift({ x: event.clientX - from.x, y: event.clientY - from.y });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    grab.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const side = sideForShelf(draft.shelf.side);
  const long = side === "long";
  const tone = long ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]";
  const plan = computeTrade({
    entry: draft.shelf.price,
    side,
    stopPct: draft.stopPct,
    margin: draft.margin,
    leverage: draft.leverage,
    takes: DEFAULT_TAKES,
  });

  const tick = draft.tick;

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onCancel}
    >
      {/* Два слоя, и это не лишний div.
          Смещение живёт снаружи, появление - внутри. Анимация появления задана
          с fill-mode both и в последнем кадре ставит transform: none, а
          анимация в CSS сильнее строчного стиля - и держит его насовсем. Пока
          оба свойства висели на одном элементе, окно не двигалось вовсе:
          смещение считалось, но до экрана не доезжало. */}
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
        className="w-[520px] max-w-full"
      >
      <div className="animate-dialog-in overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none">
        {/* Шапка: что за уровень и в какую сторону от него работаем.
            Она же ручка окна - за неё его отодвигают от графика. */}
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // touchAction: без него палец на телефоне прокручивает страницу
          // вместо того, чтобы вести окно.
          style={{ touchAction: "none" }}
          className={`flex items-start justify-between border-b border-[var(--pane-border)] px-5 py-4 select-none ${
            grab.current ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-[11px] font-semibold uppercase ${tone}`}>
                {long ? d.long : d.short}
              </span>
              <span className="font-mono text-[19px] font-semibold text-[var(--pane-text)]">
                {fmtPrice(draft.shelf.price, tick)}
              </span>
            </div>
            {/* Откуда взялась цена. От полки в стакане - сколько там денег;
                от плюсика на графике полки нет вовсе, и писать про заявки,
                которых никто не ставил, значит выдумывать. */}
            <p className="mt-1 text-[11px] text-[var(--pane-muted)]">
              {draft.shelf.notional > 0
                ? d.shelf(money(draft.shelf.notional)) + (long ? d.shelfLong : d.shelfShort)
                : long
                  ? d.fromPriceLong
                  : d.fromPriceShort}
            </p>
          </div>
          <button
            onClick={onCancel}
            title={d.cancelEsc}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 px-5 py-4">
          <Field
            label={d.amount}
            value={draft.margin}
            presets={margins}
            format={(v) => String(v)}
            onPick={(margin) => onChange({ ...draft, margin })}
          />
          <Field
            label={cap ? d.leverageCap(cap) : d.leverage}
            value={draft.leverage}
            presets={leverages}
            format={(v) => `x${v}`}
            onPick={(leverage) => onChange({ ...draft, leverage })}
          />
          <Field
            label={d.stopPct}
            value={draft.stopPct}
            presets={STOPS}
            format={(v) => String(v)}
            onPick={(stopPct) => onChange({ ...draft, stopPct })}
          />
        </div>

        {plan ? (
          <div className="border-t border-[var(--pane-border)] bg-[var(--pane-deep)]/40 px-5 py-4">
            <Row
              label={d.entry}
              price={fmtPrice(plan.entry, tick)}
              note={`${money(plan.notional)} · ${plan.qty.toPrecision(4)}`}
            />
            <Row
              label={d.stop}
              price={fmtPrice(plan.stop, tick)}
              note={d.stopNote(money(plan.risk), plan.riskPct.toFixed(1))}
              tone="text-[var(--pane-down)]"
            />
            {plan.targets.map((target, i) => (
              <Row
                key={target.r}
                label={d.take(i + 1)}
                price={fmtPrice(target.price, tick)}
                note={`+${money(target.profit)} · ${target.r}R`}
                tone="text-[var(--pane-up)]"
              />
            ))}
            <Row
              label={d.fee}
              price={money(plan.notional * (takerFee ?? TAKER_FEE) * 2)}
              note={d.feeNote}
              tone="text-[var(--pane-muted)]"
            />
            <Row
              label={d.liquidation}
              price={fmtPrice(plan.liquidation, tick)}
              note={plan.liquidatedFirst ? d.liqCloser : ""}
              tone={plan.liquidatedFirst ? "text-[var(--pane-down)]" : "text-[var(--pane-muted)]"}
            />

            {opposing > 0 && (
              <p className="mt-3 rounded-md bg-[var(--pane-down-faint)] px-3 py-2 text-[11px] leading-snug text-[var(--pane-down)]">
                {d.opposing(String(opposing))}
              </p>
            )}

            {overLimit && (
              <p className="mt-3 rounded-md bg-[var(--pane-down-faint)] px-3 py-2 text-[11px] leading-snug text-[var(--pane-down)]">
                {d.capWarning(cap ?? 0, draft.leverage)}
              </p>
            )}

            {plan.liquidatedFirst && (
              <p className="mt-3 rounded-md bg-[var(--pane-down-faint)] px-3 py-2 text-[11px] leading-snug text-[var(--pane-down)]">
                {d.liqWarning}
              </p>
            )}
          </div>
        ) : (
          <p className="border-t border-[var(--pane-border)] px-5 py-6 text-center text-[12px] text-[var(--pane-muted)]">
            {d.fillHint}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-[var(--pane-border)] px-5 py-3">
          <span className="text-[11px] text-[var(--pane-muted)]">
            {live ? (
              <span className="text-warning">{d.willGoLive}</span>
            ) : (
              // Разметка без счёта - это рисование на графике, а не торговля.
              // Раньше окно её предлагало, и сделка выглядела открытой, хотя на
              // бирже не было ничего.
              <span className="text-[var(--pane-down)]">
                {d.notConnected}
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className={`${BUTTON} text-[var(--pane-muted)] hover:text-[var(--pane-text)]`}
            >
              {t.common.cancel}
            </button>
            <button
              onClick={onConfirm}
              disabled={!plan || overLimit || !live}
              className={`${BUTTON} ${
                long ? "bg-[var(--pane-up-soft)] text-[var(--pane-up)]" : "bg-[var(--pane-down-soft)] text-[var(--pane-down)]"
              } disabled:opacity-40`}
            >
              {t.common.login}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Поле ввода с частыми значениями строкой под ним.
 *
 * Набранное держим строкой, а число отдаём только когда оно получилось. Иначе
 * промежуточный ввод не пережить: «0.» и «0,» превращаются в ноль, а пустое
 * поле — в ноль или NaN, и набранное стирается прямо под пальцами. Поле
 * текстовое намеренно: числовое браузер чистит по-своему и запятую съедает
 * вовсе, а на русской раскладке дробь набирают именно запятой.
 */
function Field({
  label,
  value,
  presets,
  format,
  onPick,
  inputRef,
}: {
  label: string;
  value: number;
  presets: number[];
  format: (value: number) => string;
  onPick: (value: number) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const [text, setText] = useState(String(value));

  // Значение сменилось снаружи — кнопкой готового значения или другим полем.
  // Пока в поле лежит то же число, набранное не трогаем.
  useEffect(() => {
    setText((current) => (Number(current.replace(",", ".")) === value ? current : String(value)));
  }, [value]);

  return (
    <div>
      <span className="mb-1.5 block text-[11px] text-[var(--pane-muted)]">{label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = Number(raw.replace(",", "."));
          if (Number.isFinite(parsed) && parsed > 0) onPick(parsed);
        }}
        onBlur={() => {
          // Ушли из поля с мусором — возвращаем последнее рабочее число.
          const parsed = Number(text.replace(",", "."));
          if (!Number.isFinite(parsed) || parsed <= 0) setText(String(value));
        }}
        className={FIELD}
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => {
              onPick(preset);
              setText(String(preset));
            }}
            className={`${CHIP} ${
              preset === value
                ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                : "text-[var(--pane-muted)] hover:bg-[var(--pane-bg)] hover:text-[var(--pane-text)]"
            }`}
          >
            {format(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Строка расчёта: название, цена и что она значит в деньгах. */
function Row({
  label,
  price,
  note,
  tone = "text-[var(--pane-text)]",
}: {
  label: string;
  price: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-1 font-mono text-[12px] tabular-nums">
      <span className="text-[var(--pane-muted)]">{label}</span>
      <span className="flex items-baseline gap-3">
        <span className={`text-[11px] ${tone === "text-[var(--pane-text)]" ? "text-[var(--pane-muted)]" : tone}`}>
          {note}
        </span>
        <span className={`w-28 text-right ${tone}`}>{price}</span>
      </span>
    </div>
  );
}
