"use client";

// «Наш софт» в правой колонке Маркета: главный продукт карточкой и ссылки на
// разделы витрины.
//
// Главный продукт - самый дорогой из нашего софта в каталоге, а не
// вписанное сюда название: цену и состав меняют в админке, и колонка
// следует за ними сама.

/* eslint-disable @next/next/no-img-element */

import { ChevronRight, Cpu, Palette, Shirt, Star, type LucideIcon } from "lucide-react";
import CoinIcon from "@/components/app/CoinIcon";
import type { ShopItem } from "@/lib/api";
import { useIntlLocale, useT, useLocale } from "@/lib/i18n";
import { itemDescription, itemTitle } from "@/lib/shopText";

export type SoftLink = "features" | "frames" | "merch" | "software";

const LINKS: { id: SoftLink; icon: LucideIcon }[] = [
  { id: "features", icon: Star },
  { id: "frames", icon: Palette },
  { id: "merch", icon: Shirt },
  { id: "software", icon: Cpu },
];

export default function SoftPanel({
  featured,
  image,
  onOpen,
  onPick,
}: {
  /** Главный продукт. Null - софта в каталоге нет, остаются одни ссылки. */
  featured: ShopItem | null;
  /** Картинка продукта, уже приведённая к адресу. */
  image: string | null;
  onOpen: (item: ShopItem) => void;
  onPick: (cat: SoftLink) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const numbers = useIntlLocale();
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <h2 className="px-3 pb-2 pt-3 text-[13px] font-bold text-[var(--pane-text)]">{t.shop.soft.title}</h2>

      {featured && (
        <div className="mx-3 mb-2 flex gap-3 rounded-xl border border-[var(--pane-gold-soft)] p-2.5"
          style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--pane-gold) 12%, transparent), transparent 70%)" }}
        >
          {image && (
            <img src={image} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="line-clamp-2 text-[12px] font-bold leading-snug text-[var(--pane-text)]">{itemTitle(featured, locale)}</p>
            {featured.description && (
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-[var(--pane-muted)]">
                {itemDescription(featured, locale)}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
              <span className="flex items-center gap-1 font-mono text-[12px] font-bold tabular-nums text-[var(--pane-gold)]">
                <CoinIcon size={13} />
                {featured.price.toLocaleString(numbers)}
              </span>
              <button
                type="button"
                onClick={() => onOpen(featured)}
                className="rounded-md px-2.5 py-1 text-[11px] font-bold text-black transition-transform duration-150 ease-out active:scale-[0.97]"
                style={{ background: "var(--pane-gold)" }}
              >
                {t.shop.soft.more}
              </button>
            </div>
          </div>
        </div>
      )}

      <ul className="border-t border-[var(--pane-border)]">
        {LINKS.map(({ id, icon: Icon }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onPick(id)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
            >
              <Icon className="h-4 w-4 shrink-0 text-[var(--pane-gold)]" />
              <span className="flex-1">{t.shop.soft.links[id]}</span>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--pane-muted)]" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
