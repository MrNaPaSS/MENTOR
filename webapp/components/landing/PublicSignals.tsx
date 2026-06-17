"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { API_URL } from "@/lib/api";

function tvImageUrl(url: string): string | null {
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

interface PreviewItem {
  id: number;
  chart_url: string;
  text: string;
  created_at: string;
}

function ChartCard({ item }: { item: PreviewItem }) {
  const img = tvImageUrl(item.chart_url);
  if (!img) return null;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.35)] transition-all duration-300 hover:border-accent-cyan/25 hover:-translate-y-1">

      {/* График - лёгкий блюр */}
      <div className="relative overflow-hidden">
        <img
          src={img}
          alt="analysis"
          className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          style={{ height: 200, filter: "blur(2.5px) brightness(0.7)" }}
        />
        {/* Градиент снизу картинки */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-bg-deep to-transparent" />
      </div>

      {/* Текст + замок */}
      <div className="p-4 space-y-3">

        {/* Описание - заблюрено */}
        {item.text && (
          <div className="relative">
            <p className="line-clamp-3 text-sm leading-relaxed text-text-secondary select-none"
              style={{ filter: "blur(3.5px)" }}>
              {item.text}
            </p>
            {/* Градиент поверх текста */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg-deep" />
          </div>
        )}

        {/* Кнопка */}
        <div className="flex items-center gap-3 pt-1">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-cyan/10 ring-1 ring-accent-cyan/20">
            <Lock className="h-3.5 w-3.5 text-accent-cyan" />
          </div>
          <Link
            href="/login"
            className="text-[12px] font-semibold text-accent-cyan/80 transition hover:text-accent-cyan"
          >
            Войти и читать полностью →
          </Link>
        </div>
      </div>

      {/* Свечение при hover */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-accent-cyan/0 transition-all duration-300 group-hover:border-accent-cyan/15 group-hover:shadow-[inset_0_0_40px_rgba(10,255,224,0.03)]" />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-bg-deep">
      <div className="skeleton" style={{ height: 200 }} />
      <div className="p-4 space-y-2">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
        <div className="skeleton h-3 w-3/5 rounded" />
      </div>
    </div>
  );
}

export default function PublicSignals() {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/broadcast/preview`, { headers: { "ngrok-skip-browser-warning": "1" } })
      .then((r) => r.ok ? r.json() : [])
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  if (loaded && items.length === 0) return null;

  return (
    <section id="signals" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="Анализы ментора"
        title="Разборы рынка - только для участников"
        subtitle="Графики с разметкой и мыслями ментора. Полный доступ - после входа."
      />

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {!loaded && Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}

        {loaded && items.map((item, i) => (
          <Reveal key={item.id} delay={i * 0.08}>
            <ChartCard item={item} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
