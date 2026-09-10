"use client";

// Строка товара в маркете.
//
// Строкой, а не карточкой с обложкой: так устроены все разделы кабинета, и
// сравнивать товары удобнее, когда цена и кнопка стоят в одной колонке, а не
// разбросаны по плиткам.

import { ExternalLink } from "lucide-react";
import type { Entitlement, ShopItem } from "@/lib/api";
import { useIntlLocale, useT } from "@/lib/i18n";
import { NUM } from "@/components/app/Pane";
import ShopIcon from "@/components/shop/ShopIcon";

const BUY =
  "rounded px-2.5 py-1 text-[11px] font-semibold transition-[transform,opacity] duration-150 ease-out active:scale-[0.97]";

/** Как продаётся товар: навсегда, на срок или зарядами. Пусто у ручных. */
function termsOf(item: ShopItem, t: ReturnType<typeof useT>): string {
  if (!item.feature) return t.shop.terms.manual;
  if ((item.charges ?? 0) > 0) return t.shop.terms.charges(item.charges ?? 0);
  if ((item.duration_days ?? 0) > 0) return t.shop.terms.days(item.duration_days ?? 0);
  return t.shop.terms.forever;
}

export default function ShopRow({
  item,
  balance,
  access,
  onBuy,
}: {
  item: ShopItem;
  balance: number;
  /** Действующий доступ к функции этого товара, если он куплен. */
  access: Entitlement | null;
  onBuy: (item: ShopItem) => void;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  const forever = Boolean(item.feature) && !(item.charges ?? 0) && !(item.duration_days ?? 0);
  const owned = forever && Boolean(access?.permanent);
  const short = item.price - balance;

  let status = "";
  if (access) {
    if (access.permanent) status = t.shop.forever;
    else if ((access.charges ?? 0) > 0) status = t.shop.chargesLeft(access.charges);
    else if (access.expires_at)
      status = t.shop.until(
        new Date(access.expires_at).toLocaleDateString(numbers, { day: "numeric", month: "short" }),
      );
  }

  return (
    <li className="flex items-start gap-3 border-b border-[var(--pane-border)] px-3 py-3 last:border-b-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--pane-border)] text-[var(--pane-gold)]">
        <ShopIcon name={item.icon} className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-[12px] font-semibold text-[var(--pane-text)]">{item.title}</h3>
          <span className="text-[10px] text-[var(--pane-muted)]">
            {termsOf(item, t)}
            {item.feature ? ` · ${t.shop.terms.instant}` : ""}
          </span>
        </div>
        {item.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--pane-muted)]">
            {item.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {status && (
            <span className="rounded bg-[var(--pane-up-faint)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--pane-up)]">
              {status}
            </span>
          )}
          {item.link_url && (
            <a
              href={item.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-[var(--pane-accent)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {item.price > 0 ? t.shop.details : t.shop.openLink}
            </a>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {item.price > 0 ? (
          <>
            <span className={`${NUM} text-[12px] font-semibold`} style={{ color: "var(--pane-gold)" }}>
              {item.price.toLocaleString(numbers)} NMNH
            </span>
            {owned ? (
              <span className={`${BUY} bg-[var(--pane-up-faint)] text-[var(--pane-up)]`}>{t.shop.bought}</span>
            ) : short > 0 ? (
              <span className={`${BUY} cursor-not-allowed text-[var(--pane-muted)]`}>
                {t.shop.notEnough(short.toLocaleString(numbers))}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onBuy(item)}
                className={`${BUY} text-black`}
                style={{ background: "var(--pane-gold)" }}
              >
                {access ? ((item.charges ?? 0) > 0 ? t.shop.buyMore : t.shop.extend) : t.shop.buy}
              </button>
            )}
          </>
        ) : (
          !item.link_url && <span className="text-[10px] text-[var(--pane-muted)]">{t.shop.soon}</span>
        )}
      </div>
    </li>
  );
}
