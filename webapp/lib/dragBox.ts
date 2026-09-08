// Панель, которую двигают рукой: где она стоит и как это пережить перезагрузку.
//
// Место панели на графике — вопрос вкуса и монитора: кто-то держит её у цены,
// кто-то уводит в пустой угол, чтобы не закрывала свечи. Спорить с этим
// вёрсткой бесполезно, поэтому положение задаёт трейдер, а наше дело —
// удержать панель в пределах холста и запомнить, куда её поставили.
//
// Здесь только арифметика и хранилище: перетаскивание — дело мыши, и оно
// живёт в компоненте. Так эта часть проверяется числами, без браузера.

/** Левый верхний угол панели в точках от левого верха холста. */
export type Spot = { x: number; y: number };

/** Габариты — панели и холста под ней. */
export type Size = { w: number; h: number };

/** Насколько близко к краю холста разрешено подводить панель, точки. */
const EDGE = 4;

/**
 * Вернуть панель в пределы холста.
 *
 * Холст меняет размер: свернули журнал, растянули стакан, вышли из полного
 * экрана. Панель, оставленная у правого края, оказывается за ним, и вернуть её
 * оттуда нечем — ухватить не за что. Поэтому положение зажимается на каждой
 * отрисовке, а не только при перетаскивании.
 *
 * Панель шире холста прижимается к левому верхнему углу: показать её начало
 * важнее, чем конец, — там заголовок, за который её и тянут.
 */
export function clampSpot(spot: Spot, box: Size, area: Size): Spot {
  const maxX = Math.max(EDGE, area.w - box.w - EDGE);
  const maxY = Math.max(EDGE, area.h - box.h - EDGE);
  return {
    x: Math.min(Math.max(EDGE, spot.x), maxX),
    y: Math.min(Math.max(EDGE, spot.y), maxY),
  };
}

/** Прочитать запомненное место. Пусто — панель встанет туда, где стояла всегда. */
export function readSpot(key: string): Spot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y } = parsed as { x?: unknown; y?: unknown };
    // Чужая или испорченная запись — это не место панели. Нечисло, пришедшее
    // из хранилища, уехало бы в стиль и панель исчезла бы с экрана насовсем.
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    // В приватном окне обращение к хранилищу бросает исключение.
    return null;
  }
}

/** Запомнить место. Не запомнилось — панель всё равно стоит там, куда её увели. */
export function keepSpot(key: string, spot: Spot | null): void {
  try {
    if (spot) localStorage.setItem(key, JSON.stringify(spot));
    else localStorage.removeItem(key);
  } catch {
    // Хранилище недоступно — переживём до конца сессии.
  }
}
