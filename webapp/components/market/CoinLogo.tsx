"use client";

// Значок монеты: логотип, а если его нет - первая буква в цветном круге.
//
// Логотипы берём из открытого набора cryptocurrency-icons: там сотни монет
// по тикеру, и адрес строится без запроса к бирже. Свежих монет в наборе нет -
// им остаётся буква, и цвет круга от тикера: одна монета всегда одного цвета.

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";

const ICONS = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

const HUES = [12, 32, 48, 145, 170, 200, 220, 262, 290, 330];

function hueOf(symbol: string): number {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export default function CoinLogo({
  symbol,
  src,
  size = 20,
}: {
  /** Тикер без котировки: BTC, а не BTCUSDT. */
  symbol: string;
  /** Своя картинка, если источник её уже дал (CoinGecko отдаёт миниатюры). */
  src?: string;
  size?: number;
}) {
  const url = src || `${ICONS}/${symbol.toLowerCase()}.svg`;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);

  if (!symbol || broken) {
    return (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-full font-bold text-white"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.48,
          background: `hsl(${hueOf(symbol)} 62% 48%)`,
        }}
      >
        {symbol.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}
