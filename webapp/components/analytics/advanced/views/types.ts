// Что получает каждый вид расширенной аналитики.
//
// Виды отличаются подачей, а не данными: сделки, итоги и форматирование им
// приходят готовыми, чтобы пять раскладок считали одно и то же одинаково.

import type { Totals } from "@/lib/analytics/advanced";
import type { Dict } from "@/lib/i18n";
import type { JournalTrade } from "@/lib/journal";

export type AdvancedDict = Dict["analytics"]["advanced"];

export interface ViewProps {
  /** Сделки периода после всех фильтров. */
  trades: readonly JournalTrade[];
  totals: Totals;
  /** Итоги прошлого периода такой же длины: с ними сравниваются числа. */
  prev: Totals;
  /** Отобранная монета: по ней подсвечена строка в разрезе. */
  symbol: string | null;
  onPick: (key: string) => void;
  /** Деньги словами, со знаком у ненулевых. */
  money: (value: number) => string;
  /** Деньги со знаком плюс у прибыли. */
  signed: (value: number) => string;
  day: (ms: number) => string;
  /**
   * Сколько места осталось до низа окна.
   *
   * Раздел занимает экран целиком, и высоту панелей нельзя задать
   * числом: на ноутбуке они не поместятся, на большом мониторе под
   * ними останется пустая треть страницы. Вид делит эту высоту между
   * своими рядами сам - он один знает, сколько их у него.
   */
  height: number;
  a: AdvancedDict;
}
