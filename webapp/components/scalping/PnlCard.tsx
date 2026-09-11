"use client";

// Карточка сделки: окно с печатью.
//
// Открывается из журнала по кнопке у строки. Внутри - тот самый лист, который
// потом уйдёт в чат: он выезжает сверху, как из принтера, и получает печать.
// Ровно эта же карточка и копируется, и скачивается, и открывается по ссылке -
// собирает её один и тот же код, поэтому разойтись они не могут.
//
// Заготовку выбирает тема терминала, а не человек: светлая тема - карточки с
// графиком, тёмная - со зверем. Отдельный выбор был бы ещё одной настройкой,
// которую надо помнить, ради того, что уже решено темой.

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, Link2, X } from "lucide-react";

import {
  defaultVariant,
  loadBackdrop,
  MARK_SRC,
  render,
  resultInk,
  sealFrame,
  variantsFor,
  type CardData,
} from "@/lib/pnl/card";
import { copy, download, share } from "@/lib/pnl/share";

export default function PnlCard({
  data,
  onClose,
}: {
  /**
   * Что показать. Готовой колонкой, а не записью журнала: тем же бланком
   * делятся итогом дня, недели и месяца, и собирать колонку умеет `lib/pnl/data`.
   */
  data: CardData;
  onClose: () => void;
}) {
  const t = useT();
  const c = t.pnlCard;
  // Заготовки на выбор - те, что подходят стороне сделки.
  //
  // Открывается первая: порядок задан наставником, и первая в нём - лицо
  // стороны. Тема терминала на это больше не влияет - при ней шорт открывался
  // с середины списка. Но выбор бывает и вкусовым - карточку показывают
  // другим, - поэтому рядом с ней стрелки.
  const choices = useMemo(() => variantsFor(data.side), [data.side]);
  const fallback = useMemo(() => defaultVariant(data.side), [data.side]);
  const [pick, setPick] = useState<number | null>(null);
  // Печать листа - событие, а не переход. Она играет один раз, при открытии
  // окна или переходе по ссылке; смена заготовки стрелками - это выбор, и
  // прогонять принтер заново на каждый выбор значит превращать движение в
  // помеху. Нажали стрелку - дальше лист просто меняется.
  const [still, setStill] = useState(false);
  // Сменилась сторона - выбор сбрасывается: он был про другой набор.
  useEffect(() => {
    setPick(null);
    setStill(false);
  }, [choices, fallback]);
  const here = Math.max(0, choices.indexOf(fallback));
  const variant =
    pick === null ? fallback : choices[((pick % choices.length) + choices.length) % choices.length];
  const seal = sealFrame(variant);

  // Лист без печати: её ставит разметка поверх, и она же движется. Картинка с
  // готовым оттиском собирается отдельно - для буфера, файла и ссылки.
  const [paper, setPaper] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const backdrop = useRef<HTMLImageElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dropped = false;
    setFailed(false);
    backdrop.current = null;
    loadBackdrop(variant)
      .then(async (image) => {
        if (dropped) return;
        backdrop.current = image;
        const canvas = await render(data, variant, false, image);
        if (!dropped) setPaper(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        if (!dropped) setFailed(true);
      });
    return () => {
      dropped = true;
    };
  }, [data, variant]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Карточка с печатью. Заготовка уже в памяти - сеть не тревожим. */
  const stamped = useCallback(
    () => render(data, variant, true, backdrop.current ?? undefined),
    [data, variant],
  );

  function onCopy() {
    // Обещание, а не готовый холст: право писать в буфер браузер отбирает при
    // первом же ожидании после нажатия.
    copy(stamped()).then((ok) =>
      setNote(ok ? c.copied : c.copyFailed),
    );
  }

  async function onDownload() {
    const name = `${data.title}-${data.side}-${data.at.slice(0, 10)}`;
    await download(await stamped(), name);
    setNote(c.saved);
  }

  async function onShare() {
    setBusy(true);
    setNote(null);
    try {
      const image = backdrop.current ?? undefined;
      const url = await share(
        await render(data, variant, true, image),
        await render(data, variant, false, image),
        data,
        variant,
      );
      if (!url) {
        setNote(c.linkFailed);
        return;
      }
      setLink(url);
      // Буфер после ожидания даётся не везде: ссылку всё равно показываем
      // строкой, чтобы её можно было забрать руками.
      const ok = await navigator.clipboard?.writeText(url).then(
        () => true,
        () => false,
      );
      setNote(ok ? c.linkCopied : c.linkReady);
    } catch {
      setNote(c.linkFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      style={
        {
          // Цвет печати - по знаку результата, а не по бланку.
          //
          // Здесь оттиск рисует разметка, а на скачиваемой картинке - холст, и
          // это две разные реализации одной печати. Холст перевели на результат
          // раньше, а разметка осталась на цвете заготовки: в окне терминала
          // печать была зелёной у убыточной сделки, а по ссылке - красной.
          "--pnl-accent": resultInk(variant.paper, data.pnl),
          // Доли рамки печати - у каждой заготовки свои, и разметка ставит
          // оттиск по тем же числам, что и холст.
          "--pnl-x": `${variant.stamp.x * 100}%`,
          "--pnl-y": `${variant.stamp.y * 100}%`,
          "--pnl-w": `${variant.stamp.w * 100}%`,
          "--pnl-h": `${variant.stamp.h * 100}%`,
          // Оттиск на планете: место считает та же функция, что и для холста,
          // а светится он цветом рамок заготовки - как на бланке сигнала.
          "--pnl-seal-x": `${seal.x * 100}%`,
          "--pnl-seal-y": `${seal.y * 100}%`,
          "--pnl-seal-w": `${seal.w * 100}%`,
          "--pnl-seal-h": `${seal.h * 100}%`,
          "--pnl-glow": variant.ink,
        } as React.CSSProperties
      }
    >
      <div
        className="my-auto flex w-full max-w-[420px] flex-col items-stretch gap-3 sm:max-w-[520px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-widest text-[var(--pane-muted)]">
            {c.title}
            {/* Точки: сколько заготовок есть и на которой стоим. Без них
                стрелки предлагают выбор неизвестной длины - непонятно, две их
                там или десять и докуда листать. */}
            {choices.length > 1 && (
              <span className="flex items-center gap-1.5">
                {choices.map((one, i) => (
                  <span
                    key={one.id}
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full transition-colors duration-150"
                    style={{
                      background:
                        one.id === variant.id
                          ? "var(--pane-accent)"
                          : "var(--pane-border)",
                    }}
                  />
                ))}
                <span className="sr-only">
                  {c.variant(choices.indexOf(variant) + 1, choices.length)}
                </span>
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            title={t.common.close}
            className="rounded p-1 text-[var(--pane-muted)] transition-colors hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pnl-slot mx-auto w-full max-w-[420px]" />
        {/* Стрелки стоят сбоку от листа, а не на нём: карточку показывают
            другим, и кнопка поверх неё читается как часть картинки. Место под
            них есть на широком окне; на узком они уходят под лист - иначе
            съели бы его ширину, а лист здесь главное. */}
        <div className="flex items-center gap-2">
          {choices.length > 1 && (
            <Blank
              side="left"
              className="hidden sm:grid"
              onClick={() => {
                setStill(true);
                setPick((now) => (now ?? here) - 1);
              }}
            />
          )}
        <div className={`pnl-window mx-auto w-full max-w-[420px]${still ? " pnl-still" : ""}`}>
          {paper ? (
            <div className="pnl-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={paper} alt={`${data.title} ${data.subtitle}`} />
              <div className="pnl-stamp">
                <div className="pnl-ink">
                  <span className="pnl-mark">
                    NMNH<small>{c.stamp}</small>
                  </span>
                  <span className="pnl-creed">TRADE · DISCIPLINE · PROFIT</span>
                </div>
                {/* Биржа сделки - часть оттиска, падает вместе с печатью. */}
                {data.venue && <span className="pnl-venue">{data.venue}</span>}
              </div>
              <div
                aria-hidden
                className="pnl-seal"
                data-paper={variant.paper}
                style={{ backgroundImage: `url(${MARK_SRC})` }}
              />
            </div>
          ) : (
            <div className="grid aspect-[640/852] place-items-center rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[12px] text-[var(--pane-muted)]">
              {failed ? c.templateFailed : c.printing}
            </div>
          )}
        </div>
          {choices.length > 1 && (
            <Blank
              side="right"
              className="hidden sm:grid"
              onClick={() => {
                setStill(true);
                setPick((now) => (now ?? here) + 1);
              }}
            />
          )}
        </div>

        {/* На узком окне стрелки перебираются под лист: там они не отнимают у
            него ширину. */}
        {choices.length > 1 && (
          <div className="flex justify-center gap-3 sm:hidden">
            <Blank
              side="left"
              onClick={() => {
                setStill(true);
                setPick((now) => (now ?? here) - 1);
              }}
            />
            <Blank
              side="right"
              onClick={() => {
                setStill(true);
                setPick((now) => (now ?? here) + 1);
              }}
            />
          </div>
        )}

        <div className="flex gap-2">
          <Action icon={<Copy className="h-4 w-4" />} label={c.copy} onClick={onCopy} disabled={!paper} />
          <Action icon={<Download className="h-4 w-4" />} label={c.download} onClick={onDownload} disabled={!paper} />
          <Action
            icon={<Link2 className="h-4 w-4" />}
            label={busy ? c.preparing : c.link}
            onClick={onShare}
            disabled={!paper || busy}
          />
        </div>

        {link && (
          <input
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-[var(--pane-border)] bg-[var(--pane-deep)] px-2.5 py-2 font-mono text-[11px] text-[var(--pane-text)] outline-none"
          />
        )}
        {note && (
          <p className="text-center text-[11px] text-[var(--pane-muted)]">{note}</p>
        )}
      </div>
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] py-2 text-[12px] font-semibold text-[var(--pane-text)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Стрелка выбора заготовки. Стоит рядом с листом, а не поверх него.
 *
 * Показывать её или прятать решает то место, куда её поставили: сбоку от листа
 * она нужна на широком окне, под листом - на узком. Сама кнопка о ширине не
 * знает - иначе одна и та же вёрстка отвечала бы за две разные раскладки.
 */
function Blank({
  side,
  onClick,
  className = "",
}: {
  side: "left" | "right";
  onClick: () => void;
  className?: string;
}) {
  const t = useT();
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      title={t.pnlCard.otherTemplate}
      aria-label={side === "left" ? t.pnlCard.prevTemplate : t.pnlCard.nextTemplate}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-text-2)] transition-colors hover:border-[var(--pane-accent)] hover:text-[var(--pane-text)] ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
