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

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { askSymbol } from "@/lib/openSymbol";
import { authReq } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import type { ScreenerRow } from "@/lib/scalping";

/** Как часто спрашиваем цены. */
const POLL_MS = 15_000;

/** Сколько пар показываем: первые по обороту. */
const SHOWN = 18;

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
  const trackRef = useRef<HTMLDivElement>(null);

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
        if (!stopped && Array.isArray(body?.rows)) setRows(body.rows);
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

  if (!rows.length) return null;

  return (
    // У строки свой набор цветов на каждую тему - он задан переменными
    // `--tick-*`. Тёмный остался тем, с которым её задумывали; светлый не взят
    // у панелей терминала, а подобран отдельно: витрина рынка не обязана
    // совпадать с ними, но на белой странице обязана быть белой.
    <div
      className="group overflow-hidden border-b"
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
        // Курсор на строке останавливает её.
        //
        // Прочитать цену бегущей пары нельзя, а нажать на неё - тем более: к
        // моменту нажатия под курсором уже соседняя. Пауза на всю строку, а не
        // на одну пару: остановить надо ленту, по которой ведут курсор.
        // py-1.5 вместе с отступом самой пары держит прежнюю высоту строки: на
        // неё рассчитан отступ содержимого под шапкой.
        className="flex w-max animate-marquee py-1.5 will-change-transform group-hover:[animation-play-state:paused]"
      >
        {/* Две одинаковые половины. Вторая - для глаза, а не для чтения: она
            повторяет первую, и озвучивать её ещё раз незачем. */}
        <Half rows={rows} />
        <Half rows={rows} clone />
      </div>
    </div>
  );
}

function Half({ rows, clone }: { rows: ScreenerRow[]; clone?: boolean }) {
  return (
    // Отступ справа вместо зазора после последней пары: зазор ставится только
    // между соседями, и на стыке половин его не хватало - лента дёргалась на
    // пол-отступа каждый круг. Здесь у половины свой хвост, и её ширина ровно
    // половина ленты.
    <div className="flex gap-8 pr-8" aria-hidden={clone}>
      {rows.map((row) => (
        <Pair key={row.symbol} row={row} />
      ))}
    </div>
  );
}

/**
 * Пара в ленте.
 *
 * Через memo: цены приезжают раз в пятнадцать секунд, и без него React
 * перебирал бы все строки, включая те, у которых ничего не менялось, - прямо
 * посреди движения ленты.
 */
const Pair = memo(function Pair({ row }: { row: ScreenerRow }) {
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
      title={
        heavy
          ? `${sym} - плита ${money(row.wall_notional)}, открыть график и стакан`
          : `${sym} - открыть график и стакан`
      }
      className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-[background-color,transform] duration-150 ease-out hover:scale-[1.06] hover:bg-[var(--tick-hover)] motion-reduce:hover:scale-100"
      style={heavy ? { background: "rgb(var(--accent-gold) / 0.12)" } : undefined}
    >
      {/* Цветная точка = индикатор направления */}
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      />
      <span
        className="font-semibold"
        style={{ color: heavy ? "rgb(var(--accent-gold))" : "var(--tick-symbol)" }}
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
          style={{ color: "rgb(var(--accent-gold))" }}
        >
          {money(row.wall_notional)}
        </span>
      )}
    </Link>
  );
});
