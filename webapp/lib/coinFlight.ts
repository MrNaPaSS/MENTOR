"use client";

// Полёт монет от кнопки «Забрать» к счётчику в шапке.
//
// Число, сменившееся само, легко пропустить: награда должна быть видна в
// момент получения, иначе ожидание было ни к чему. Монеты, долетевшие до
// счётчика, показывают, куда ушла награда, а счётчик в это время
// прокручивается от старого баланса к новому (useRollingNumber).
//
// Движение - только transform и opacity через element.animate: считает
// видеокарта, и кадры не зависят от того, чем занят React.
//
// Дуга без расчёта кривой: горизонталь и вертикаль идут разными кривыми на
// двух вложенных элементах. Внешний везёт по X плавным ease-in-out,
// внутренний по Y резким ease-out - монета сперва взмывает, потом
// доворачивает к счётчику.

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

/** Полёт одной монеты. Длиннее интерфейсных 300 мс намеренно: это праздник, а не отклик. */
const FLIGHT_MS = 720;
/** Разбег между монетами: вместе они читаются горстью, а не одним пятном. */
const STAGGER_MS = 45;
const COIN_PX = 18;

/** Монета картинкой: та же, что в счётчике, чтобы в него летело то, что в нём лежит. */
function imageCoin(src: string): string {
  return [
    `width:${COIN_PX}px`,
    `height:${COIN_PX}px`,
    "border-radius:9999px",
    `background:url("${src}") center / contain no-repeat`,
    "filter:drop-shadow(0 0 6px rgb(var(--coin) / 0.6))",
    "will-change:transform,opacity",
  ].join(";");
}

const COIN_STYLE = [
  `width:${COIN_PX}px`,
  `height:${COIN_PX}px`,
  "border-radius:9999px",
  "background:radial-gradient(circle at 35% 30%, #fff4cc 0%, rgb(var(--coin)) 55%, rgb(var(--coin) / 0.8) 100%)",
  "border:1px solid rgb(var(--coin))",
  "box-shadow:0 0 10px rgb(var(--coin) / 0.55), inset 0 -1px 0 rgba(0,0,0,0.25)",
  "will-change:transform,opacity",
].join(";");

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Счётчик, к которому летят монеты.
 *
 * Мест с пометкой два: полный чип на широком экране и значок на узком.
 * Спрятанное имеет нулевой размер - берём то, что видно.
 */
export function coinTarget(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-coin-target]"));
  return (
    all.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) ?? null
  );
}

/** Сколько монет лететь: по одной на пять, но не меньше горсти и не больше дюжины. */
export function coinsFor(amount: number): number {
  return Math.max(4, Math.min(12, Math.round(amount / 5)));
}

type FlightOptions = {
  /** Первая монета долетела - пора крутить счётчик. */
  onFirstLand?: () => void;
  /** Картинка монеты. Нет - рисуем золотой кружок. */
  src?: string;
};

/**
 * Запустить полёт. Промис разрешается, когда долетела последняя монета.
 *
 * Без движения (настройка системы «уменьшить движение») монеты не летят:
 * счётчик просто подсвечивается, и число меняется сразу.
 */
export async function flyCoins(
  from: DOMRect,
  amount: number,
  { onFirstLand, src }: FlightOptions = {},
): Promise<void> {
  const target = coinTarget();
  const canAnimate = typeof document !== "undefined" && typeof document.body.animate === "function";

  if (!target || !canAnimate || prefersReducedMotion()) {
    onFirstLand?.();
    if (target && canAnimate) glow(target);
    return;
  }

  const to = target.getBoundingClientRect();
  // Цель - значок монеты у левого края чипа, а не его середина.
  const x1 = to.left + Math.min(18, to.width / 2) - COIN_PX / 2;
  const y1 = to.top + to.height / 2 - COIN_PX / 2;
  const x0 = from.left + from.width / 2 - COIN_PX / 2;
  const y0 = from.top + from.height / 2 - COIN_PX / 2;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:95;overflow:hidden";
  document.body.appendChild(layer);

  let landed = false;
  const count = coinsFor(amount);

  const flights = Array.from({ length: count }, (_, i) => {
    // Разлёт от кнопки веером: монеты стартуют не из одной точки.
    const spread = (i - (count - 1) / 2) * 7;
    const sx = x0 + spread;
    const sy = y0 + (i % 2 === 0 ? 0 : 6);
    const delay = i * STAGGER_MS;

    const outer = document.createElement("div");
    outer.style.cssText = "position:absolute;left:0;top:0;will-change:transform";
    const coin = document.createElement("div");
    coin.style.cssText = src ? imageCoin(src) : COIN_STYLE;
    outer.appendChild(coin);
    layer.appendChild(outer);

    outer.animate(
      [{ transform: `translateX(${sx}px)` }, { transform: `translateX(${x1}px)` }],
      { duration: FLIGHT_MS, delay, easing: EASE_IN_OUT, fill: "both" },
    );
    const vertical = coin.animate(
      [
        { transform: `translateY(${sy}px) scale(0.7)`, opacity: 0 },
        { transform: `translateY(${sy - 8}px) scale(1)`, opacity: 1, offset: 0.1 },
        { transform: `translateY(${y1 + 2}px) scale(0.8)`, opacity: 1, offset: 0.88 },
        // Растворяется в счётчике, а не ложится на него кучей.
        { transform: `translateY(${y1}px) scale(0.5)`, opacity: 0 },
      ],
      { duration: FLIGHT_MS, delay, easing: EASE_OUT, fill: "both" },
    );

    return vertical.finished.then(
      () => {
        if (!landed) {
          landed = true;
          onFirstLand?.();
        }
      },
      () => undefined,
    );
  });

  await Promise.all(flights);
  layer.remove();
  if (!landed) onFirstLand?.();

  bump(target);
  floatLabel(to, `+${amount.toLocaleString()}`);
}

/** Счётчик принял горсть: короткий подскок, один на всё получение. */
function bump(el: HTMLElement): void {
  el.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.1)" }, { transform: "scale(1)" }],
    { duration: 320, easing: EASE_OUT },
  );
  glow(el);
}

/** Подсветка без движения: её оставляем и тем, кто просил меньше анимации. */
function glow(el: HTMLElement): void {
  el.animate(
    [
      { boxShadow: "0 0 0 0 rgb(var(--coin) / 0)" },
      { boxShadow: "0 0 18px 2px rgb(var(--coin) / 0.55)", offset: 0.3 },
      { boxShadow: "0 0 0 0 rgb(var(--coin) / 0)" },
    ],
    { duration: 900, easing: EASE_OUT },
  );
}

/** «+40» всплывает над счётчиком и тает: сумма, которую только что забрали. */
function floatLabel(at: DOMRect, text: string): void {
  const label = document.createElement("div");
  label.setAttribute("aria-hidden", "true");
  label.textContent = text;
  label.style.cssText = [
    "position:fixed",
    `left:${at.left + at.width / 2}px`,
    `top:${at.bottom + 4}px`,
    "transform:translateX(-50%)",
    "pointer-events:none",
    "z-index:95",
    "font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:rgb(var(--coin))",
    "text-shadow:0 0 8px rgb(var(--coin) / 0.5)",
  ].join(";");
  document.body.appendChild(label);

  const anim = label.animate(
    [
      { transform: "translate(-50%, 6px)", opacity: 0 },
      { transform: "translate(-50%, 0)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -10px)", opacity: 0 },
    ],
    { duration: 1100, easing: EASE_OUT, fill: "both" },
  );
  anim.finished.then(
    () => label.remove(),
    () => label.remove(),
  );
}
