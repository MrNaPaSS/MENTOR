"use client";

// Бегущая строка рынка.
//
// Витрина: пятнадцать пар с ценой и суточным изменением, бесконечной лентой.
// Она же и вход в терминал - нажатие на пару открывает её график со стаканом.
//
// Лента бесшовная. Едет она на половину своей ширины, а собрана из двух
// одинаковых половин, поэтому в конце пути вторая половина стоит ровно там,
// откуда начинала первая, и возврат в ноль не виден.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { askSymbol } from "@/lib/openSymbol";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
  "DOGEUSDT", "AVAXUSDT", "ADAUSDT", "LTCUSDT", "DOTUSDT",
  "MATICUSDT", "LINKUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
];

interface Ticker {
  symbol: string;
  price: number;
  change: number; // % за 24ч
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)     return price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export default function MarketTicker() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        // Binance public API - без ключей, точные цены в реальном времени
        const symbolsParam = encodeURIComponent(JSON.stringify(SYMBOLS));
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`
        );
        if (!res.ok) return;
        const data: Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
        }> = await res.json();

        setTickers(
          data.map((t) => ({
            symbol: t.symbol,
            price: parseFloat(t.lastPrice),
            change: parseFloat(t.priceChangePercent),
          }))
        );
      } catch {
        // При ошибке ничего не показываем - тикер скрыт
      }
    }

    load();
    const id = setInterval(load, 15_000); // обновление каждые 15с
    return () => clearInterval(id);
  }, []);

  if (!tickers.length) return null;

  return (
    // У строки свой набор цветов на каждую тему - он задан переменными
    // `--tick-*`. Тёмный остался тем, с которым её задумывали; светлый не
    // взят у панелей терминала, а подобран отдельно: витрина рынка не обязана
    // совпадать с ними, но на белой странице обязана быть белой.
    <div
      className="group overflow-hidden border-b backdrop-blur-sm"
      style={{ background: "var(--tick-bg)", borderColor: "var(--tick-line)" }}
    >
      <div
        ref={trackRef}
        // Курсор на строке останавливает её.
        //
        // Прочитать цену бегущей пары нельзя, а нажать на неё - тем более:
        // к моменту нажатия под курсором уже соседняя. Пауза на всю строку, а
        // не на одну пару: остановить надо ленту, по которой ведут курсор.
        // py-1.5 вместе с отступом самой пары держит прежнюю высоту строки:
        // на неё рассчитан отступ содержимого под шапкой.
        className="flex w-max animate-marquee py-1.5 will-change-transform group-hover:[animation-play-state:paused]"
      >
        {/* Две одинаковые половины. Вторая - для глаза, а не для чтения: она
            повторяет первую, и озвучивать её ещё раз незачем. */}
        <Half items={tickers} />
        <Half items={tickers} clone />
      </div>
    </div>
  );
}

function Half({ items, clone }: { items: Ticker[]; clone?: boolean }) {
  return (
    // Отступ справа вместо зазора после последней пары: зазор ставится только
    // между соседями, и на стыке половин его не хватало - лента дёргалась на
    // пол-отступа каждый круг. Здесь у половины свой хвост, и её ширина ровно
    // половина ленты.
    <div className="flex gap-8 pr-8" aria-hidden={clone}>
      {items.map((t) => (
        <Pair key={t.symbol} t={t} />
      ))}
    </div>
  );
}

function Pair({ t }: { t: Ticker }) {
  const pos = t.change >= 0;
  const sym = t.symbol.replace("USDT", "");
  return (
    // Нажатие открывает пару в терминале - с её графиком и стаканом. Монета
    // передаётся адресом: терминал читает её при открытии, а рабочее место
    // трейдера при этом не переписывается.
    <Link
      href={`/app/scalping?symbol=${t.symbol}`}
      // Адрес открывает терминал с другой страницы, событие - когда терминал
      // уже на экране: переход внутри приложения страницу не пересоздаёт, и
      // адрес там прочитать некому.
      onClick={() => askSymbol(t.symbol)}
      title={`${sym} - открыть график и стакан`}
      className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-[background-color,transform] duration-150 ease-out hover:scale-[1.06] hover:bg-[var(--tick-hover)] motion-reduce:hover:scale-100"
    >
      {/* Цветная точка = индикатор направления */}
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      />
      <span className="font-semibold" style={{ color: "var(--tick-symbol)" }}>
        {sym}
      </span>
      <span
        className="font-mono font-medium tabular-nums"
        style={{ color: "var(--tick-price)" }}
      >
        ${formatPrice(t.price)}
      </span>
      <span
        className="font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: pos ? "var(--tick-up)" : "var(--tick-down)" }}
      >
        {pos ? "▲" : "▼"} {Math.abs(t.change).toFixed(2)}%
      </span>
    </Link>
  );
}
