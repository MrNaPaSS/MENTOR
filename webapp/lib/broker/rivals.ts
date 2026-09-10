/**
 * Подписочная модель, с которой мы сравниваемся.
 *
 * Тарифы взяты с витрин крипто-брокеров, торгующих доступом к бирже по
 * абонплате: три ступени, и чем дороже ступень, тем выше обещанный возврат
 * комиссии. Имя сервиса не называется намеренно - конструкция у них общая, а
 * конкретные цены и проценты меняются от месяца к месяцу, и страница, которая
 * спорит с чужим прайсом по имени, устаревает в тот день, когда он поменялся.
 *
 * Сравнение честное ровно потому, что считается той же арифметикой, что и
 * наше предложение: см. economics.ts, planOutcome() и subscriptionBreakeven().
 */
import type { SubscriptionPlan } from "./economics";

/**
 * Три ступени типового прайса.
 *
 * Разница между соседними - два-пять пунктов возврата за двадцать-семьдесят
 * долларов доплаты. Из этого соотношения и вырастают пороги окупаемости,
 * которые показывает раздел «почему у нас нет тарифов».
 */
export const RIVAL_PLANS: readonly SubscriptionPlan[] = [
  { id: "lite", price: 9, share: 0.38 },
  { id: "pro", price: 29, share: 0.4 },
  { id: "ultra", price: 99, share: 0.45 },
] as const;

/** Верхний тариф: с ним сравнивается наш возврат в калькуляторе. */
export const RIVAL_TOP = RIVAL_PLANS[RIVAL_PLANS.length - 1];

/**
 * Что подписочные тарифы режут по ступеням.
 *
 * Список - не выдумка для контраста, а перенос строк из реального прайса.
 * `ours` говорит, на каком уровне это доступно у нас; везде «всем», и в этом
 * весь раздел: у нас нет ступеней, значит нечего и урезать.
 */
export interface FeatureRow {
  id: string;
  /** На каком тарифе конкурента появляется: индекс в RIVAL_PLANS или -1, если нет нигде. */
  fromPlan: number;
}

export const FEATURE_ROWS: readonly FeatureRow[] = [
  { id: "workspaces", fromPlan: 2 },
  { id: "widgets", fromPlan: 1 },
  { id: "history", fromPlan: 2 },
  { id: "dailyLossLimit", fromPlan: 1 },
  { id: "withdrawLock", fromPlan: 2 },
  { id: "subaccountLock", fromPlan: 2 },
  { id: "alertGroups", fromPlan: 1 },
  { id: "customDashboard", fromPlan: 2 },
  { id: "simulator", fromPlan: 2 },
  { id: "vipSupport", fromPlan: 2 },
] as const;
