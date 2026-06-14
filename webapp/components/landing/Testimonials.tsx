import SectionHeading from "@/components/ui/SectionHeading";
import { TESTIMONIALS, type Testimonial } from "@/lib/content";

function Card({ t }: { t: Testimonial }) {
  return (
    <figure className="group w-[340px] shrink-0 rounded-2xl border border-border bg-bg-card p-6 transition hover:border-accent-cyan/50 hover:shadow-glow-soft">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.pravatar.cc/80?u=${t.avatarSeed}`}
          alt={t.name}
          className="h-11 w-11 rounded-full ring-1 ring-border"
          loading="lazy"
        />
        <div>
          <figcaption className="font-semibold text-white">{t.name}</figcaption>
          <div className="text-xs text-text-muted">{t.mode}</div>
        </div>
        <span className="ml-auto font-mono text-sm font-bold text-success">{t.pnl}</span>
      </div>
      <blockquote className="mt-4 text-sm leading-relaxed text-text-secondary">
        «{t.quote}»
      </blockquote>
    </figure>
  );
}

export default function Testimonials() {
  // Дублируем массив для бесшовной marquee-прокрутки.
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

      <div className="group relative mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div className="flex w-max gap-5 animate-marquee group-hover:[animation-play-state:paused]">
          {loop.map((t, i) => (
            <Card key={`${t.avatarSeed}-${i}`} t={t} />
          ))}
        </div>
      </div>
    </section>
  );
}
