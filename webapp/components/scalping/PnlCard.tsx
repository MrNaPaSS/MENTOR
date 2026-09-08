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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, Link2, X } from "lucide-react";

import type { JournalTrade } from "@/lib/journal";
import { loadBackdrop, render, resultInk, variantFor, variantsFor } from "@/lib/pnl/card";
import { cardFromTrade } from "@/lib/pnl/data";
import { copy, download, share } from "@/lib/pnl/share";
import { useTerminalTheme } from "@/lib/terminalTheme";

export default function PnlCard({
  trade,
  owner,
  onClose,
}: {
  trade: JournalTrade;
  /** Имя владельца в подписи. Пусто - подписи не будет. */
  owner?: string;
  onClose: () => void;
}) {
  const data = useMemo(() => cardFromTrade(trade, owner), [trade, owner]);
  const theme = useTerminalTheme();
  // Заготовки на выбор - те, что подходят стороне сделки.
  //
  // По умолчанию берётся та, что под темой терминала: она уже сказала всё, что
  // нужно, и заставлять выбирать при каждом открытии незачем. Но выбор бывает
  // и вкусовым - карточку показывают другим, - поэтому рядом с ней стрелки.
  const choices = useMemo(() => variantsFor(data.side), [data.side]);
  const fallback = useMemo(() => variantFor(theme, data.side), [theme, data.side]);
  const [pick, setPick] = useState<number | null>(null);
  // Печать листа - событие, а не переход. Она играет один раз, при открытии
  // окна или переходе по ссылке; смена заготовки стрелками - это выбор, и
  // прогонять принтер заново на каждый выбор значит превращать движение в
  // помеху. Нажали стрелку - дальше лист просто меняется.
  const [still, setStill] = useState(false);
  // Сменилась сторона или тема - выбор сбрасывается: он был про другой набор.
  useEffect(() => {
    setPick(null);
    setStill(false);
  }, [choices, fallback]);
  const here = Math.max(0, choices.indexOf(fallback));
  const variant =
    pick === null ? fallback : choices[((pick % choices.length) + choices.length) % choices.length];

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
      setNote(ok ? "Карточка в буфере" : "Браузер не дал скопировать - сохраните файлом"),
    );
  }

  async function onDownload() {
    const name = `${data.symbol}-${data.side}-${data.at.slice(0, 10)}`;
    await download(await stamped(), name);
    setNote("Файл сохранён");
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
        setNote("Ссылку не удалось получить");
        return;
      }
      setLink(url);
      // Буфер после ожидания даётся не везде: ссылку всё равно показываем
      // строкой, чтобы её можно было забрать руками.
      const ok = await navigator.clipboard?.writeText(url).then(
        () => true,
        () => false,
      );
      setNote(ok ? "Ссылка скопирована" : "Ссылка готова - скопируйте её ниже");
    } catch {
      setNote("Ссылку не удалось получить");
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
        } as React.CSSProperties
      }
    >
      <div
        className="my-auto flex w-full max-w-[420px] flex-col items-stretch gap-3 sm:max-w-[520px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-widest text-[var(--pane-muted)]">
            Карточка сделки
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
                  Заготовка {choices.indexOf(variant) + 1} из {choices.length}
                </span>
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            title="Закрыть"
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
              <img src={paper} alt={`${data.symbol} ${data.side}`} />
              <div className="pnl-stamp">
                <div className="pnl-ink">
                  <span className="pnl-mark">
                    NMNH<small>ПОДТВЕРЖДЕНО ТЕРМИНАЛОМ</small>
                  </span>
                  <span className="pnl-creed">TRADE · DISCIPLINE · PROFIT</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid aspect-[640/852] place-items-center rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[12px] text-[var(--pane-muted)]">
              {failed ? "Заготовка карточки не загрузилась" : "Печатаем..."}
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
          <Action icon={<Copy className="h-4 w-4" />} label="Скопировать" onClick={onCopy} disabled={!paper} />
          <Action icon={<Download className="h-4 w-4" />} label="Скачать" onClick={onDownload} disabled={!paper} />
          <Action
            icon={<Link2 className="h-4 w-4" />}
            label={busy ? "Готовим..." : "Ссылка"}
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
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      title="Другая заготовка"
      aria-label={side === "left" ? "Предыдущая заготовка" : "Следующая заготовка"}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-text-2)] transition-colors hover:border-[var(--pane-accent)] hover:text-[var(--pane-text)] ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
