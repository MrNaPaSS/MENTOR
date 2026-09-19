// Чем кончилась сделка - для подписи последнего снимка.
//
// Снимков у сделки три рода: вход, сопровождение и выход. В сопровождение идут
// промежуточные цели - первая, вторая, - а выход бывает один, и подписан он
// должен быть тем, что на самом деле случилось: последняя цель, безубыток или
// стоп. Подписать стоп «целью 3» значит соврать в разборе о том, чем кончилась
// работа, - а разбор ради этого и ведётся.
//
// Почему не «что исчезло с биржи». В миг закрытия позиции с биржи уходит вся
// её защита разом: и стоп, и оставшиеся цели. По этому нельзя отличить взятую
// цель от выбитого стопа - исчезает одно и то же.
//
// Отличает цена. Стоп и цели стоят по разные стороны входа, и расстояние между
// ними - десятки шагов цены; расхождение нашего стакана с биржей в десяток
// пунктов рядом с этим ничего не значит. Что ближе к цене закрытия, то и
// сработало.
//
// Слово сервера важнее: он видел сделку целиком и знает её исход. Цена нужна
// там, где исход ещё не доехал, - а снимок ждать не может, свеча уходит.

/** Чем кончилась сделка. */
export type ExitKind = "take" | "breakeven" | "stop" | "manual";

/** Исход сделки словами сервера. */
export type ServerOutcome = "stop" | "take" | "manual" | null | undefined;

export interface ExitTrade {
  side: "long" | "short";
  entry: number;
  stop: number;
  targets: readonly number[];
}

/**
 * Стоял ли стоп в безубытке - на входе или лучше него.
 *
 * Это и есть разница между «стоп» и «безубыток» в разборе: в первом случае
 * сделка стоила денег, во втором - нет, хотя кончилась она тем же движением
 * цены к стопу.
 */
export function stopIsSafe(trade: ExitTrade): boolean {
  if (!(trade.stop > 0) || !(trade.entry > 0)) return false;
  return trade.side === "long" ? trade.stop >= trade.entry : trade.stop <= trade.entry;
}

/**
 * Чем кончилась сделка.
 *
 * `mid` - цена в миг закрытия. Ноль означает, что стакана под рукой нет; тогда
 * остаётся судить по стопу, и это честнее выдуманной цели.
 */
export function exitKind(trade: ExitTrade, mid: number, outcome?: ServerOutcome): ExitKind {
  if (outcome === "manual") return "manual";
  if (outcome === "take") return "take";
  if (outcome === "stop") return stopIsSafe(trade) ? "breakeven" : "stop";

  const last = trade.targets.length > 0 ? trade.targets[trade.targets.length - 1] : 0;
  if (mid > 0 && last > 0 && trade.stop > 0) {
    const toTake = Math.abs(mid - last);
    const toStop = Math.abs(mid - trade.stop);
    if (toTake < toStop) return "take";
  }

  return stopIsSafe(trade) ? "breakeven" : "stop";
}
