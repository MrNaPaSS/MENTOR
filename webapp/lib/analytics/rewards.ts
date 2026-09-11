// Награды аналитики: типы целей и достижений и их картинки.
//
// Картинка берётся по ключу, а не лежит полем в каждой записи: у каждой цели и
// каждого достижения она своя и одна, и таблица соответствий только
// разошлась бы с файлами в public/art.

import type { Dict } from "@/lib/i18n";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export type AchCategory = "all" | "volume" | "discipline" | "performance" | "deposit" | "special";

export type GoalId = keyof Dict["analytics"]["goals"] & string;

export type AchievementId = keyof Dict["analytics"]["achievements"]["items"] & string;

export interface Goal {
  id: GoalId;
  target: number;
  current: number;
  /** Цвет полосы: у каждой цели свой, как у её картинки. */
  color: string;
  unlocked: boolean;
}

export interface Achievement {
  id: AchievementId;
  earned: boolean;
  rarity: Rarity;
  category: Exclude<AchCategory, "all">;
  xp: number;
}

/** Сколько монет даёт достижение: по редкости. Та же шкала, что на сервере. */
export const RARITY_COINS: Record<Rarity, number> = {
  common: 10,
  rare: 25,
  epic: 50,
  legendary: 100,
};

/** Откуда набирается опыт - ключи совпадают со строками словаря level.sources. */
export type XpSource = "volume" | "streak" | "hotDays" | "profit" | "days" | "goals";

/**
 * Картинка источника опыта.
 *
 * У горячих дней своей плитки в наборе нет: берём звезду одноимённой цели
 * месяца - это одно и то же событие.
 */
export const XP_ART: Record<XpSource, string> = {
  volume: "/art/xp/volume.webp",
  streak: "/art/xp/streak.webp",
  hotDays: "/art/goals/hot_day.webp",
  profit: "/art/xp/profit.webp",
  days: "/art/xp/days.webp",
  goals: "/art/xp/goals.webp",
};

export const LEVEL_ART = "/art/xp/level.webp";

export function goalArt(id: GoalId): string {
  return `/art/goals/${id}.webp`;
}

export function achievementArt(id: AchievementId): string {
  return `/art/ach/${id}.webp`;
}
