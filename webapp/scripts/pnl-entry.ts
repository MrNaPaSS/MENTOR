// Вход бандла для генератора витрины: наружу отдаём ровно то, чем рисует
// терминал, - иначе картинки на лендинге разойдутся с тем, что человек
// получит из журнала своей сделки.

export { VARIANTS, render, price, stamped } from "@/lib/pnl/card";
export type { CardData, Variant } from "@/lib/pnl/card";
