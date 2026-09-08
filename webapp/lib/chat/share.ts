"use client";

// Чем делятся в чате: сделка из журнала, ждущая заявка с графика и снимок.
//
// Снимок цифр, а не ссылка на живую запись. Сделка после этого закроется,
// заявку отменят или переставят - сообщение обязано остаться тем, что человек
// показал: разговор о цифрах, которые молча поменялись, бессмысленен.

import type { JournalTrade } from "@/lib/journal";
import type { ActiveTrade } from "@/lib/trade/position";
import { post, type SharedTrade } from "./store";

/** Закрытая сделка журнала. */
export function fromJournal(trade: JournalTrade): SharedTrade {
  return {
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.entry,
    stop: trade.stop,
    targets: trade.targets,
    qty: trade.qty,
    leverage: trade.leverage,
    state: "closed",
    pnl: trade.pnl,
    takesHit: trade.takes_hit,
    margin: trade.margin,
    outcome: trade.outcome,
    fee: trade.fee,
  };
}

/** Заявка или позиция с графика. */
export function fromActive(trade: ActiveTrade): SharedTrade {
  return {
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.entry,
    stop: trade.stop,
    targets: trade.targets,
    qty: trade.qty,
    leverage: trade.leverage,
    state: trade.status === "open" ? "open" : "planned",
    takesHit: trade.takesHit,
  };
}

/** Отправить сделку или заявку в чат. */
export function share(trade: SharedTrade, text = ""): Promise<void> {
  return post(text, { kind: "trade", trade });
}

/** Отправить снимок графика: в ленте он откроется страницей на сайте. */
export function shareShot(url: string, id: string, text = ""): Promise<void> {
  return post(text, { kind: "shot", url, image: id });
}
