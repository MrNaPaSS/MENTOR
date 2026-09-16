// Вход бандла для генератора витрины: наружу отдаём ровно то, чем рисует
// терминал, - иначе картинки на лендинге разойдутся с тем, что человек
// получит из журнала своей сделки. Список сделок берётся оттуда же, откуда
// его читает сама витрина.

export { VARIANTS, render, price, stamped } from "@/lib/pnl/card";
export type { CardData, Variant } from "@/lib/pnl/card";
export { SHOWCASE_TRADES, SHOWCASE_OWNER, SHOWCASE_VENUE } from "@/lib/showcase";
