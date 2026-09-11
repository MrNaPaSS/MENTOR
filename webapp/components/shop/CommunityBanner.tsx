"use client";

// Баннер сообщества в Маркете: монеты зарабатываются вместе с остальными, и
// дорога к ним - через общий чат.
//
// Всегда тёмный, в обеих темах: это плакат, а не панель, и золото на нём
// читается только на чёрном.

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function CommunityBanner() {
  const t = useT();
  return (
    <Link
      href="/app/chat"
      className="group relative block overflow-hidden rounded-xl border border-accent-gold/40 p-4 text-white transition-[transform,box-shadow] duration-200 ease-out hover:shadow-[0_10px_30px_-12px_rgba(240,185,11,0.55)] active:scale-[0.99]"
      style={{
        background:
          "radial-gradient(circle at 85% 30%, rgba(240,185,11,0.28), transparent 55%), linear-gradient(135deg, #0b0b0d 0%, #16130a 100%)",
      }}
    >
      <img
        src="/art/brand/coins.webp"
        alt=""
        className="pointer-events-none absolute -bottom-3 -right-3 h-36 w-auto transition-transform duration-300 ease-out group-hover:scale-[1.04] motion-reduce:group-hover:scale-100"
      />
      <img src="/art/brand/logo.webp" alt="NMNH" className="relative h-14 w-auto" />
      <p className="relative mt-2 text-[15px] font-extrabold uppercase leading-tight tracking-wide">
        {t.shop.community.lines.map((line, i) => (
          <span key={line} className={`block ${i === 0 ? "text-[var(--pane-gold)]" : ""}`}>
            {line}
          </span>
        ))}
      </p>
      <span
        className="relative mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-black"
        style={{ background: "linear-gradient(90deg, #f5c542, #e0a800)" }}
      >
        {t.shop.community.join}
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
