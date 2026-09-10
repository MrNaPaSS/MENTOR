"use client";

// Бегущая строка рынка.
//
// Витрина и вход в терминал разом: нажатие на пару открывает её график со
// стаканом.
//
// Пары берём у скринера - те же, что видит терминал.
//
// Раньше список был свой, из пятнадцати имён, набранных руками, и цены к нему
// приходили напрямую с биржи. Разойтись со скринером он мог в любой день: MATIC
// в ленте был, а открыть его терминал не мог - пары в скринере нет, и нажатие
// вело в пустоту. Общий источник эту рассинхронизацию убирает сам: в ленте не
// может оказаться того, чего терминал не покажет.
//
// Лента бесшовная. Едет она на половину своей ширины, а собрана из двух
// одинаковых половин, поэтому в конце пути вторая половина стоит ровно там,
// откуда начинала первая, и возврат в ноль не виден.

import { useT } from "@/lib/i18n";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTerminalTheme } from "@/lib/terminalTheme";
import { askSymbol } from "@/lib/openSymbol";
import { authReq } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import type { ScreenerRow } from "@/lib/scalping";
import { keepOrder, sameRow, sameRows } from "@/lib/tickerRows";

/** Как часто спрашиваем цены. */
const POLL_MS = 15_000;

/** Сколько пар показываем: первые по обороту. */
const SHOWN = 18;

/**
 * Скорость ленты - пикселей в секунду.
 *
 * Именно скорость, а не длительность круга. Длительность была задана намертво
 * (сорок секунд на круг), и лента разгонялась от каждой новой пары: чем длиннее
 * список, тем больше пикселей приходилось на те же сорок секунд. Здесь наоборот
 * - скорость постоянна, а круг занимает столько, сколько нужно.
 *
 * Двадцать восемь пикселей в секунду. Медленное движение читается как течение,
 * быстрое - как рывки: глаз замечает, что строка смещается скачками по
 * пикселю, только когда скачки редкие и крупные.
 */
const SPEED = 28;

/**
 * С какой плиты пара считается той, «где есть большая ликвидность».
 *
 * Плита - самая крупная одиночная заявка в стакане. Миллион долларов в одной
 * заявке держит цену как стена, и трейдер идёт смотреть именно туда. Цифра
 * абсолютная, а не доля от списка: доля пометила бы лучшую из имеющихся даже в
 * день, когда крупного нет вовсе.
 */
const BIG_WALL = 1_000_000;

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)     return price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

/** Плита словами: миллионы и тысячи, без длинных хвостов. */
function money(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

export default function MarketTicker() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  // Звезда двух цветов: чёрная на белой ленте, зелёная на тёмной - чёрная на
  // тёмной пропадает.
  const star = useTerminalTheme() === "light" ? "/marks/star.png" : "/marks/star-green.png";
  const trackRef = useRef<HTMLDivElement>(null);
  const halfRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<Animation | null>(null);
  const shown = rows.length > 0;

  useEffect(() => {
    let stopped = false;

    async function load() {
      const token = getAccessToken();
      if (!token) return;
      try {
        const body = await authReq<{ rows: ScreenerRow[] }>(
          `/api/scalping/screener?sort=volume&limit=${SHOWN}`,
          token,
        );
        // Пустой ответ - сбой скринера, а не пустой рынок: оставляем прошлые
        // цены, а не прячем ленту до следующего опроса.
        if (stopped || !Array.isArray(body?.rows) || !body.rows.length) return;
        const fresh = body.rows;
        setRows((prev) => {
          const next = keepOrder(prev, fresh);
          return sameRows(prev, next) ? prev : next;
        });
      } catch {
        // Не ответил - показываем прошлые цены, они секундной давности.
      }
    }

    load();
    let id = window.setInterval(load, POLL_MS);

    // Свёрнутую вкладку не опрашиваем.
    //
    // Цены за спиной никто не читает, а каждый круг - это запрос и перерисовка
    // строк. Вернулись к вкладке - обновляем сразу, чтобы первое, что человек
    // увидит, не было ценой получасовой давности.
    function watch() {
      window.clearInterval(id);
      if (document.hidden) return;
      load();
      id = window.setInterval(load, POLL_MS);
    }

    document.addEventListener("visibilitychange", watch);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", watch);
    };
  }, []);

  // Движение ленты.
  //
  // Раньше это была CSS-анимация, и длительность круга стояла в стиле. Цены
  // приходят раз в пятнадцать секунд, цифры меняют ширину - и с ней менялась
  // длительность. Браузер на смене длительности пересчитывает, где лента
  // должна быть в этот момент, и переставляет её туда: строка то дёргалась
  // назад, то догоняла себя.
  //
  // Здесь анимация одна на всё время жизни ленты. Сменилась ширина - берём
  // пройденный путь, подставляем новую длину круга и ставим ленту ровно туда,
  // где она стояла. Считает движение по-прежнему видеокарта, поэтому тяжёлый
  // график в терминале его не тормозит.
  useEffect(() => {
    const track = trackRef.current;
    const half = halfRef.current;
    if (!track || !half || typeof track.animate !== "function") return;
    // Кто попросил систему не двигать интерфейс - получает строку, которую
    // можно читать, а не догонять.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let span = 0;
    let motion: Animation | null = null;

    function fit() {
      // Круг округляем до пикселя: половина ленты меряется по тексту и
      // шириной выходит дробной, а стык на дробном сдвиге дрожит краями.
      const width = Math.round(half!.getBoundingClientRect().width);
      if (!width || width === span) return;
      const travelled = motion && span ? ((Number(motion.currentTime) || 0) / 1000) * SPEED : 0;
      const frames = [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(${-width}px, 0, 0)` },
      ];
      const duration = (width / SPEED) * 1000;
      if (motion?.effect instanceof KeyframeEffect) {
        motion.effect.setKeyframes(frames);
        motion.effect.updateTiming({ duration });
      } else {
        motion = track!.animate(frames, { duration, iterations: Infinity, easing: "linear" });
        motionRef.current = motion;
      }
      // Половины одинаковые, поэтому место на круге - остаток от деления.
      motion.currentTime = (((span ? travelled % span : 0) % width) / SPEED) * 1000;
      span = width;
    }

    fit();
    // Наблюдатель срабатывает после раскладки и до отрисовки: новая длина
    // круга встаёт в том же кадре, где поменялись цифры, и скачка не видно.
    const watcher = new ResizeObserver(fit);
    watcher.observe(half);
    return () => {
      watcher.disconnect();
      motion?.cancel();
      motionRef.current = null;
    };
  }, [shown]);

  // Звезда одна на всю ленту: она отмечает не «крупную плиту» - для этого есть
  // золото, - а самую крупную из всех. Две звезды в строке не значили бы
  // ничего. Если крупных плит нет вовсе, звезды нет тоже: отмечать лучшего из
  // мелких незачем.
  const king = useMemo(
    () =>
      rows.reduce<ScreenerRow | null>(
        (best, row) =>
          row.wall_notional >= BIG_WALL && (!best || row.wall_notional > best.wall_notional)
            ? row
            : best,
        null,
      )?.symbol,
    [rows],
  );

  if (!shown) return null;

  return (
    // У строки свой набор цветов на каждую тему - он задан переменными
    // `--tick-*`. Тёмный остался тем, с которым её задумывали; светлый не взят
    // у панелей терминала, а подобран отдельно: витрина рынка не обязана
    // совпадать с ними, но на белой странице обязана быть белой.
    <div
      className="overflow-hidden border-b"
      // Курсор на строке останавливает её.
      //
      // Прочитать цену бегущей пары нельзя, а нажать на неё - тем более: к
      // моменту нажатия под курсором уже соседняя. Пауза на всю строку, а не
      // на одну пару: остановить надо ленту, по которой ведут курсор.
      onMouseEnter={() => motionRef.current?.pause()}
      onMouseLeave={() => motionRef.current?.play()}
      style={{
        background: "var(--tick-bg)",
        borderColor: "var(--tick-line)",
        // Полоса живёт сама по себе: то, что происходит внутри неё, не может
        // изменить ничего снаружи. Браузер на этом основании перестаёт
        // пересчитывать раскладку страницы на каждый кадр её движения.
        contain: "content",
      }}
    >
      <div
        ref={trackRef}
        // py-1.5 вместе с отступом самой пары держит прежнюю высоту строки: на
        // неё рассчитан отступ содержимого под шапкой.
        className="flex w-max py-1.5 [backface-visibility:hidden] will-change-transform"
      >
        {/* Две одинаковые половины. Вторая - для глаза, а не для чтения: она
            повторяет первую, и озвучивать её ещё раз незачем. */}
        <Half rows={rows} king={king} innerRef={halfRef} star={star} />
        <Half rows={rows} king={king} clone star={star} />
      </div>
    </div>
  );
}

function Half({
  rows,
  king,
  clone,
  innerRef,
  star,
}: {
  rows: ScreenerRow[];
  king?: string;
  clone?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
  star: string;
}) {
  return (
    // Отступ справа вместо зазора после последней пары: зазор ставится только
    // между соседями, и на стыке половин его не хватало - лента дёргалась на
    // пол-отступа каждый круг. Здесь у половины свой хвост, и её ширина ровно
    // половина ленты.
    <div ref={innerRef} className="flex gap-8 pr-8" aria-hidden={clone}>
      {rows.map((row) => (
        <Pair key={row.symbol} row={row} crowned={row.symbol === king} star={star} />
      ))}
    </div>
  );
}

/**
 * Пара в ленте.
 *
 * Через memo со своим сравнением: цены приезжают раз в пятнадцать секунд
 * новым массивом, и обычный memo пропустил бы всё - объекты-то новые. Здесь
 * пара перерисовывается, только когда поменялось то, что в ней видно.
 */
const Pair = memo(function Pair({
  row,
  crowned,
  star,
}: {
  row: ScreenerRow;
  crowned?: boolean;
  /** Рисунок звезды под лист ленты: чёрная на белом, зелёная на тёмном. */
  star: string;
}) {
  const t = useT();
  const pos = row.change_pct >= 0;
  const sym = row.symbol.replace(/USDT$/, "");
  // Крупная плита - золотом. Тем же цветом она отмечена в стакане и на
  // графике: одно и то же явление не должно называться в терминале двумя
  // разными цветами.
  const heavy = row.wall_notional >= BIG_WALL;
  return (
    // Нажатие открывает пару в терминале - с её графиком и стаканом. Монета
    // передаётся адресом, а событием - уже открытому терминалу: переход внутри
    // приложения страницу не пересоздаёт, и адрес там прочитать некому.
    <Link
      href={`/app/scalping?symbol=${row.symbol}`}
      onClick={() => askSymbol(row.symbol)}
      title={[
        sym,
        crowned ? t.market.ticker.biggestWall : null,
        heavy ? t.market.ticker.wall(money(row.wall_notional)) : null,
        t.market.ticker.openChart,
      ]
        .filter(Boolean)
        .join(" · ")}
      className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-[background-color,transform] duration-150 ease-out hover:scale-[1.06] hover:bg-[var(--tick-hover)] motion-reduce:hover:scale-100"
      style={heavy ? { background: "var(--tick-heavy)" } : undefined}
    >
      {/* Цветная точка = индикатор направления */}
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      />
      {/* Звезда - у самой крупной плиты дня. Значком, а не цветом: цвет плиты
          уже занят золотом, и «крупная» от «самой крупной» им не отличить.
          Звездой, а не короной: это наша отметка - та же, что на лучшем дне
          календаря и на полученных наградах. */}
      {crowned && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={star} alt="" className="h-3.5 w-3.5 shrink-0" />
      )}
      <span
        className="font-semibold"
        style={{ color: heavy ? "var(--tick-heavy-ink)" : "var(--tick-symbol)" }}
      >
        {sym}
      </span>
      <span
        className="font-mono font-medium tabular-nums"
        style={{ color: "var(--tick-price)" }}
      >
        ${formatPrice(row.price)}
      </span>
      <span
        className="font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      >
        {pos ? "▲" : "▼"} {Math.abs(row.change_pct).toFixed(2)}%
      </span>
      {/* Размер плиты - только когда она крупная: у остальных это шум. */}
      {heavy && (
        <span
          className="font-mono text-[10px] font-bold tabular-nums"
          style={{ color: "var(--tick-heavy-ink)" }}
        >
          {money(row.wall_notional)}
        </span>
      )}
    </Link>
  );
},
(a, b) => a.crowned === b.crowned && a.star === b.star && sameRow(a.row, b.row));
