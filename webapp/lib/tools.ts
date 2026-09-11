"use client";

// Инструменты терминала за монеты: раздел маркета «Инструменты».
//
// Бесплатно у всех: стакан в 30 строк, шаги ×1, ×5 и ×10, полки ликвидности и
// объём под графиком. Остальное открывает покупка - или отметка VIP, которую
// ставит наставник. Те же правила держит сервер (backend/tools.py): без них
// он отдаёт бесплатный уровень, как бы его ни попросили, - кнопки здесь
// только говорят об этом честно.

import { useMemo } from "react";
import { useEntitlements } from "./entitlements";

export const TOOL = {
  /** Разметка графика целиком, кроме полок: тренд, структура, блоки, FVG, зоны, EMA. */
  vision: "tool_vision",
  volumeCandles: "tool_volume_candles",
  footprint: "tool_footprint",
  depth: "tool_dom_depth",
  step25: "tool_dom_step25",
} as const;

/** Сколько строк стакана у всех бесплатно. */
export const FREE_ROWS = 30;
/** Самый крупный бесплатный шаг сетки стакана. */
export const FREE_MAX_AGG = 10;

/** Слои разметки, которые открывает NMNH VISION. Полки и объём - у всех. */
export const VISION_LAYERS = ["trend", "structure", "blocks", "gaps", "zones", "ema"] as const;

/** Куда ведёт кнопка с замком: сразу в нужный раздел маркета. */
export const TOOLS_SHOP = "/app/shop?cat=tools";

export type Tools = {
  /** Список покупок прочитан. До этого замков не рисуем и настроек не режем. */
  loaded: boolean;
  vision: boolean;
  volumeCandles: boolean;
  footprint: boolean;
  depth: boolean;
  step25: boolean;
};

export function useTools(): Tools {
  const access = useEntitlements();
  return useMemo(
    () => ({
      loaded: access.loaded,
      // Пока список не прочитан - считаем открытым: у купившего инструмент не
      // должен на мгновение мигнуть замок, а сервер без прав всё равно
      // отдаст бесплатный уровень.
      vision: !access.loaded || access.has(TOOL.vision),
      volumeCandles: !access.loaded || access.has(TOOL.volumeCandles),
      footprint: !access.loaded || access.has(TOOL.footprint),
      depth: !access.loaded || access.has(TOOL.depth),
      step25: !access.loaded || access.has(TOOL.step25),
    }),
    [access.loaded, access.has],
  );
}

/** Глубина стакана, которую реально показываем: без покупки не глубже бесплатной. */
export function allowedRows(rows: number, depth: boolean): number {
  return depth ? rows : Math.min(rows, FREE_ROWS);
}

/** Шаг сетки, который реально показываем: без покупки не крупнее ×10. */
export function allowedAgg(agg: number, step25: boolean): number {
  return step25 ? agg : Math.min(agg, FREE_MAX_AGG);
}
