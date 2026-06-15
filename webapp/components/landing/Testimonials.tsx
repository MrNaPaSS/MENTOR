import SectionHeading from "@/components/ui/SectionHeading";
import { TESTIMONIALS, type Testimonial } from "@/lib/content";

function StarRating({ n = 5 }: { n?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className={`h-3.5 w-3.5 ${i < n ? "text-accent-gold" : "text-white/10"}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function Card({ t }: { t: Testimonial }) {
  const isPositive = t.pnl.startsWith("+");
  return (
    <figure
      className="group relative w-[360px] shrink-0 overflow-hidden rounded-2xl border border-white/8 p-px transition-all duration-500 hover:-translate-y-1"
      style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)" }}
    >
      {/* Hover border gradient */}
      <div className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.5), transparent 50%)", WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "destination-out", padding: "1px" }}
      />

      {/* Quote mark */}
      <div className="absolute right-5 top-3 select-none font-serif text-7xl leading-none text-white/[0.04] group-hover:text-white/[0.07] transition-colors">"</div>

      <div className="relative z-10 p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="relative">
            <img
              src={`https://i.pravatar.cc/80?u=${t.avatarSeed}`}
              alt={t.name}
              className="h-12 w-12 rounded-2xl object-cover ring-2 ring-white/10 transition group-hover:ring-accent-cyan/30"
              loading="lazy"
            />
            <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-success ring-2 ring-bg-deep">
              <svg className="h-2.5 w-2.5 text-bg-deep" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <figcaption className="font-bold text-white">{t.name}</figcaption>
            <div className="text-xs text-text-muted">{t.mode}</div>
            <StarRating />
          </div>

          {/* PnL */}
          <div className="shrink-0 text-right">
            <div
              className="rounded-xl px-3 py-1.5 font-mono text-base font-extrabold"
              style={{
                background: isPositive ? "rgba(0,212,160,0.10)" : "rgba(255,71,87,0.10)",
                color: isPositive ? "#00D4A0" : "#FF4757",
                border: `1px solid ${isPositive ? "rgba(0,212,160,0.20)" : "rgba(255,71,87,0.20)"}`,
              }}
            >
              {t.pnl}
            </div>
            <div className="mt-0.5 text-center text-[9px] text-text-muted">за 30 дней</div>
          </div>
        </div>

        {/* Цитата */}
        <blockquote className="mt-4 text-sm leading-relaxed text-text-secondary">
          «{t.quote}»
        </blockquote>

        {/* Bottom line */}
        <div className="mt-4 h-px bg-gradient-to-r from-accent-cyan/0 via-accent-cyan/20 to-accent-cyan/0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      </div>
    </figure>
  );
}

export default function Testimonials() {
  const loop = [...TESTIMONIALS, ...TESTIMONIALS];
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading
          eyebrow="Отзывы учеников"
          title="Реальные результаты"
          subtitle="Скриншоты PnL публикуются с согласия учеников."
        />
      </div>

      <div className="group relative mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max gap-5 animate-marquee group-hover:[animation-play-state:paused]">
          {loop.map((t, i) => (
            <Card key={`${t.avatarSeed}-${i}`} t={t} />
          ))}
        </div>
      </div>
    </section>
  );
}
