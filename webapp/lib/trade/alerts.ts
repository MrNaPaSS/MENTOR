// Отметки на ценах: терминал скажет, когда уровень пересекут.
//
// Сделкой это не является и на бирже не существует — только напоминание.
// Скальпер не может смотреть на десять монет сразу, а уровень, который он ждал
// полчаса, пробивают за секунду.

export type PriceAlert = {
  id: string;
  symbol: string;
  price: number;
};

/**
 * Какие отметки пересекла цена между двумя кадрами.
 *
 * Событие — не «цена выше уровня», а «цена была по другую его сторону»:
 * иначе отметка звенела бы на каждом кадре, пока рынок стоит над ней. Момент
 * ровного касания считаем пересечением: цена дошла до уровня, а именно этого
 * трейдер и ждал.
 */
export function crossedAlerts(
  alerts: PriceAlert[],
  symbol: string | null,
  previous: number,
  current: number,
): PriceAlert[] {
  if (!symbol || !(previous > 0) || !(current > 0)) return [];
  return alerts.filter(
    (alert) =>
      alert.symbol === symbol &&
      alert.price > 0 &&
      ((previous < alert.price && current >= alert.price) ||
        (previous > alert.price && current <= alert.price)),
  );
}
