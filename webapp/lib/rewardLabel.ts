// Как назвать начисление монет человеческими словами.
//
// Сервер отдаёт причину и ссылку на событие (`achievement` + `streak_7`,
// `level_up` + `level_5`). Показывать это как есть нельзя, а заводить на
// сервере второй словарь подписей значит держать два перевода одного и того
// же. Подписи живут в словаре кабинета, здесь - только разбор ссылки.

import type { CoinTx } from "./api";
import type { Dict } from "./i18n";

export function rewardLabel(tx: Pick<CoinTx, "reason" | "ref">, t: Dict): string {
  switch (tx.reason) {
    case "achievement": {
      // Названия достижений уже есть в аналитике - берём оттуда, а не
      // переводим второй раз.
      const items = t.analytics.achievements.items as Record<string, { title: string } | undefined>;
      const title = items[tx.ref]?.title;
      return title ? t.rewards.achievement(title) : t.rewards.reasons.achievement;
    }
    case "level_up": {
      const n = Number(tx.ref.replace(/^level_/, ""));
      return Number.isInteger(n) && n > 0 ? t.rewards.level(n) : t.rewards.reasons.level_up;
    }
    case "trade_streak": {
      // `streak_<сделка>_<длина серии>`: длина - последнее звено.
      const n = Number(tx.ref.split("_").pop());
      return Number.isInteger(n) && n > 0 ? t.rewards.streak(n) : t.rewards.reasons.trade_streak;
    }
    case "volume_milestone": {
      const label = tx.ref.replace(/^vol_milestone_/, "");
      return label ? t.rewards.milestone(label) : t.rewards.reasons.volume_milestone;
    }
  }
  const reasons = t.rewards.reasons as Record<string, string | undefined>;
  return reasons[tx.reason] ?? t.rewards.reasons.other;
}
