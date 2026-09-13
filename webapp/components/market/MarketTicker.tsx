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
import { marqueeSpan, marqueeSpeed, needsRebuild, travelled } from "@/lib/marquee";

/** Как часто спрашиваем цены. */
const POLL_MS = 15_000;

/** Сколько пар показываем: первые по обороту. */
const SHOWN = 18;

// Скорость ленты подбирается под экран - см. lib/marquee.ts: около тридцати
// пикселей в секунду, и ровно пиксель экрана раз в целое число кадров. Именно
// скорость, а не длительность круга: длительность, заданная намертво, разгоняла
// ленту от каждой новой пары.

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
  // Анимация у каждой пары своя, а круг один на всех.
  const motionsRef = useRef<Animation[]>([]);
  // Лента стоит под курсором. Помним это: пересобранные на ходу анимации -
  // пришла новая пара - должны родиться тоже стоящими.
  const pausedRef = useRef(false);
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
  // Сначала это была CSS-анимация с длительностью круга в стиле: цены меняли
  // ширину, с ней длительность, и браузер переставлял ленту - она дёргалась
  // назад и догоняла себя. Потом одна анимация на всю полосу, с сохранением
  // пути при смене ширины.
  //
  // Но полоса - две половины по восемнадцать пар, семь тысяч пикселей, и
  // двигалась она целиком. Firefox ведёт на видеокарте только слой не шире
  // окна (примерно в 1.1 раза), а более широкий дорисовывает кусками на главном
  // потоке. В терминале этот поток занят графиком и стаканом - и строка лагала
  // именно там.
  //
  // Теперь каждая пара едет своим слоем в две сотни пикселей: такой видеокарта
  // берёт целиком. Все пары на одном круге и с одним временем, так что строка
  // движется как единое целое. Шаг - ровно пиксель экрана: ступени одинаковые,
  // и текст не стоит на дробном пикселе, где мелкие буквы дрожат краями.
  useEffect(() => {
    const track = trackRef.current;
    const half = halfRef.current;
    if (!track || !half || typeof track.animate !== "function") return;
    // Кто попросил систему не двигать интерфейс - получает строку, которую
    // можно читать, а не догонять.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = window.devicePixelRatio || 1;
    const speed = marqueeSpeed(dpr);
    // Ступени - только под мышью. Safari на iPad не умеет отдать видеокарте
    // анимацию со steps() и крутит её на главном потоке, а тот на время
    // прокрутки пальцем занят жестом: лента дёргалась ровно пока листают и
    // оживала, стоило остановиться. Прямую он ведёт на видеокарте, а дрожь
    // краёв на дробном пикселе на экране планшета с плотностью 2x не видна.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    let span = 0;
    let motions: Animation[] = [];

    function build() {
      const next = marqueeSpan(half!.getBoundingClientRect().width, dpr);
      const nodes = Array.from(track!.querySelectorAll<HTMLElement>("[data-tick]"));
      if (!nodes.length || !next.steps) return;
      // Пересобираем, только когда заметно поменялся круг или сами пары:
      // пара, сменившая соседа, - новый элемент, и своей анимации у неё ещё
      // нет. Круг, разошедшийся на пиксель от новой цены, не трогаем: сама
      // пересборка видна рывком, а пиксель на стыке половин - нет.
      const sameNodes =
        nodes.length === motions.length &&
        motions.every((m, i) => (m.effect as KeyframeEffect | null)?.target === nodes[i]);
      if (sameNodes && !needsRebuild(span, next.css)) return;

      // Лента продолжает с того места, где стояла: половины одинаковые, и место
      // на новом круге - остаток от деления.
      const at = travelled(Number(motions[0]?.currentTime) || 0, speed, span) % next.css;
      for (const m of motions) m.cancel();

      const frames = [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(${-next.css}px, 0, 0)` },
      ];
      const timing: KeyframeAnimationOptions = {
        duration: (next.css / speed) * 1000,
        iterations: Infinity,
        // Ступень на пиксель экрана, а не плавная прямая: прямая ставит слой
        // между пикселями на каждом кадре.
        easing: touch ? "linear" : `steps(${next.steps}, end)`,
      };
      const time = (at / speed) * 1000;
      motions = nodes.map((node) => {
        const one = node.animate(frames, timing);
        one.currentTime = time;
        if (pausedRef.current) one.pause();
        return one;
      });
      motionsRef.current = motions;
      span = next.css;
    }

    // Первый круг - по ширине, которую даёт настоящий шрифт. Пока грузится
    // запасной, буквы уже, круг короче, и лента, поехав сразу, спотыкалась на
    // первой же секунде: шрифт доезжал, ширина менялась, круг пересобирался.
    let dropped = false;
    const begin = () => {
      if (!dropped) build();
    };
    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(begin).catch(begin);
    } else {
      build();
    }
    // Ширина половины - по цифрам цен; наблюдатель срабатывает после раскладки
    // и до отрисовки, поэтому новый круг встаёт в том же кадре. Состав пар -
    // вторым наблюдателем: новичок ширину может и не поменять.
    const sizes = new ResizeObserver(build);
    sizes.observe(half);
    const members = new MutationObserver(build);
    members.observe(track, { childList: true, subtree: true });
    return () => {
      dropped = true;
      sizes.disconnect();
      members.disconnect();
      for (const m of motions) m.cancel();
      motionsRef.current = [];
    };
  }, [shown]);

  /** Остановить ленту или пустить дальше - все пары разом, с одного места. */
  function hold(stop: boolean) {
    pausedRef.current = stop;
    const all = motionsRef.current;
    const at = all[0]?.currentTime ?? null;
    for (const m of all) {
      if (stop) m.pause();
      else {
        // Все с одного места: иначе пары, пущенные в разные мгновения,
        // разошлись бы на кадр.
        if (at !== null) m.currentTime = at;
        m.play();
      }
    }
  }

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
      //
      // Только под мышью. Safari на iPad перед тапом присылает поддельный
      // mouseenter, и остановка ленты в нём - видимая перемена - заставляла его
      // считать первое касание наведением: click не приходил, и тап по паре
      // никуда не вёл. Палец и так не ведёт по строке, останавливать нечего.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") hold(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") hold(false);
      }}
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
        className="flex w-max py-1.5"
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
        // Своя обёртка для движения: сама пара на наведении увеличивается, и
        // её собственный transform не должен спорить с ходом ленты.
        <div key={row.symbol} data-tick className="shrink-0 will-change-transform [backface-visibility:hidden]">
          <Pair row={row} crowned={row.symbol === king} star={star} />
        </div>
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
      // По базовой линии, а не по центру: название набрано обычным шрифтом, а
      // цена и проценты - моноширинным, и у них разные верх и низ. По центру
      // рамок название вставало ниже цифр. Точка и звезда - значки, их место
      // по центру строки.
      className="flex items-baseline gap-1.5 rounded-md px-2 py-0.5 text-xs transition-[background-color,transform] duration-150 ease-out hover:scale-[1.06] hover:bg-[var(--tick-hover)] motion-reduce:hover:scale-100"
      style={heavy ? { background: "var(--tick-heavy)" } : undefined}
    >
      {/* Цветная точка = индикатор направления */}
      <span
        className="inline-block h-1.5 w-1.5 self-center rounded-full"
        style={{ backgroundColor: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      />
      {/* Звезда - у самой крупной плиты дня. Значком, а не цветом: цвет плиты
          уже занят золотом, и «крупная» от «самой крупной» им не отличить.
          Звездой, а не короной: это наша отметка - та же, что на лучшем дне
          календаря и на полученных наградах. */}
      {crowned && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={star} alt="" className="h-3.5 w-3.5 shrink-0 self-center" />
      )}
      {/* Ровно по базовой линии, без сдвига. Подъём на пиксель, сделанный,
          когда название казалось опущенным, на деле ставил его выше цены. */}
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
      {/* Ширина под «12.34%»: у процента растёт целая часть, и без запаса
          каждая такая цена сдвигала бы всю ленту следом за собой. */}
      <span
        className="inline-block min-w-[6.5ch] font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      >
        {pos ? "▲" : "▼"} {Math.abs(row.change_pct).toFixed(2)}%
      </span>
      {/* Размер плиты - только когда она крупная: у остальных это шум. */}
      {heavy && (
        <span
          className="inline-block min-w-[4ch] text-right font-mono text-[10px] font-bold tabular-nums"
          style={{ color: "var(--tick-heavy-ink)" }}
        >
          {money(row.wall_notional)}
        </span>
      )}
    </Link>
  );
},
(a, b) => a.crowned === b.crowned && a.star === b.star && sameRow(a.row, b.row));
