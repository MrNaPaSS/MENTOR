"use client";

import { useEffect, useState } from "react";
import SectionHeading from "@/components/ui/SectionHeading";
import { API_URL } from "@/lib/api";

function PnlCard({ src }: { src: string }) {
  return (
    <div className="group relative w-[380px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/25 hover:shadow-[0_12px_40px_rgba(10,255,224,0.07)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="PnL результат"
        className="w-full transition-transform duration-500 group-hover:scale-[1.03]"
        loading="lazy"
      />
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg-deep/80 to-transparent" />
    </div>
  );
}

export default function Testimonials() {
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/api/pnl`, { headers: { "ngrok-skip-browser-warning": "1" } })
      .then((r) => r.ok ? r.json() : { images: [] })
      // Терпим оба формата ответа: строки "/pln/x" (старый бэк) и {name,url} (новый)
      .then((d) => {
        const items: unknown[] = d.images ?? [];
        const urls = items
          .map((i) => (typeof i === "string" ? i : (i as { url?: string }).url))
          .filter((u): u is string => typeof u === "string" && u.length > 0);
        setImages(urls);
      })
      .catch(() => {});
  }, []);

  if (images.length === 0) return null;

  const loop = [...images, ...images];

  return (
    <section id="results" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading
          eyebrow="Результаты учеников"
          title="Реальные PnL"
          subtitle="Скриншоты с биржи. Публикуются с согласия учеников."
        />
      </div>

      <div className="group relative mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max gap-4 animate-marquee group-hover:[animation-play-state:paused]">
          {loop.map((src, i) => (
            <PnlCard key={i} src={src} />
          ))}
        </div>
      </div>
    </section>
  );
}
