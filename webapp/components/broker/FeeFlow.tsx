"use client";

import { Coins, Landmark, Repeat } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

const ICONS = [Coins, Landmark, Repeat];

/**
 * Откуда берутся деньги на возврат.
 *
 * Раздел существует ради одного возражения: «бесплатный терминал - значит,
 * платить буду чем-то другим». Пока человек не увидел, из чего платят нам, он
 * ищет скрытую цену в себе самом. Поэтому сначала схема потока, и только
 * потом слова.
 */
export default function FeeFlow() {
  const t = useT();
  const d = t.broker.flow.diagram;

  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.broker.flow.eyebrow}
        title={t.broker.flow.title}
        subtitle={t.broker.flow.subtitle}
      />

      {/* Схема шире телефона по-честному: ужать её до 360 пикселей значит
          сделать подписи нечитаемыми. Поэтому у неё своя горизонтальная
          прокрутка, а страница под ней не едет. */}
      <Reveal className="mt-14">
        <div className="overflow-x-auto rounded-2xl border border-border bg-bg-card/40 p-4 md:p-6">
          <svg
            viewBox="0 0 860 300"
            className="mx-auto block h-auto w-full min-w-[560px] max-w-3xl"
            role="img"
            aria-label={`${d.trader} → ${d.exchange} → ${d.nmnh} → ${d.cashback}`}
          >
            <defs>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--text-muted))" />
              </marker>
              <marker id="flow-arrow-cyan" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--accent-cyan))" />
              </marker>
            </defs>

            {/* Три участника. Трейдер слева и он же получатель возврата:
                деньги уходят по верхней дуге и возвращаются по нижней. */}
            {[
              { x: 60, label: d.trader },
              { x: 340, label: d.exchange },
              { x: 620, label: d.nmnh },
            ].map((node) => (
              <g key={node.label}>
                <rect
                  x={node.x}
                  y={110}
                  width={180}
                  height={72}
                  rx={16}
                  fill="rgb(var(--bg-panel))"
                  stroke="rgb(var(--border))"
                />
                <text
                  x={node.x + 90}
                  y={152}
                  textAnchor="middle"
                  fontSize="19"
                  fontWeight="700"
                  fill="rgb(var(--text-primary))"
                >
                  {node.label}
                </text>
              </g>
            ))}

            {/* Комиссия: трейдер платит бирже. */}
            <path d="M 240 146 L 330 146" stroke="rgb(var(--text-muted))" strokeWidth="2" fill="none" markerEnd="url(#flow-arrow)" />
            <text x={285} y={132} textAnchor="middle" fontSize="14" fill="rgb(var(--text-muted))">
              {d.commission}
            </text>

            {/* Ребейт: биржа делится с нами. */}
            <path d="M 520 146 L 610 146" stroke="rgb(var(--text-muted))" strokeWidth="2" fill="none" markerEnd="url(#flow-arrow)" />
            <text x={565} y={132} textAnchor="middle" fontSize="14" fill="rgb(var(--text-muted))">
              {d.rebate}
            </text>

            {/* Возврат: длинная дуга обратно к трейдеру - её видно первой, и
                это правильно, потому что она и есть предложение. */}
            <path
              d="M 710 182 C 710 268, 150 268, 150 182"
              stroke="rgb(var(--accent-cyan))"
              strokeWidth="2.5"
              fill="none"
              markerEnd="url(#flow-arrow-cyan)"
            />
            <text x={430} y={281} textAnchor="middle" fontSize="15" fontWeight="600" fill="rgb(var(--accent-cyan))">
              {d.cashback}
            </text>

            {/* Наша доля: короткая стрелка вверх, намеренно скромная. */}
            <path d="M 710 110 L 710 62" stroke="rgb(var(--text-muted))" strokeWidth="2" fill="none" markerEnd="url(#flow-arrow)" />
            <text x={710} y={48} textAnchor="middle" fontSize="14" fill="rgb(var(--text-muted))">
              {d.margin}
            </text>
          </svg>
        </div>
      </Reveal>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {t.broker.flow.steps.map((step, i) => {
          const Icon = ICONS[i % ICONS.length];
          return (
            <Reveal as="article" key={step.title} delay={i * 0.1}>
              <div className="h-full rounded-2xl border border-border bg-bg-card/40 p-5">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-bold text-text-primary">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.text}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.3}>
        <p className="mx-auto mt-8 max-w-2xl text-center text-text-secondary">
          {t.broker.flow.footnote}
        </p>
      </Reveal>
    </section>
  );
}
