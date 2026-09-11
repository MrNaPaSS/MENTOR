// Шаг бегущей строки.
//
// Строка дёргалась по двум причинам, и обе - в числах, а не в вёрстке.
//
// Первая - скорость, не кратная частоте кадров. Двадцать восемь пикселей в
// секунду на экране 60 Гц - это 0.47 пикселя за кадр: сдвиг выпадал то через
// два кадра, то через три, и глаз видел неровные ступеньки. А между
// ступеньками слой стоял на дробном пикселе, и мелкий текст дрожал краями.
//
// Здесь скорость подобрана под экран: один пиксель экрана ровно раз в целое
// число кадров. Лента идёт ступенями по пикселю, без дробей, и ступени
// одинаковые.

/** Желаемая скорость, CSS-пикселей в секунду. Выходит близкая к ней. */
export const TARGET_SPEED = 30;

/** Частота, под которую ровняем шаг: у большинства экранов 60 Гц. */
const HZ = 60;

function ratioOf(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * Скорость в CSS-пикселях в секунду: пиксель экрана раз в целое число кадров.
 *
 * На обычном экране это 30 - пиксель каждые два кадра. На экране с
 * масштабом 150% - 40, пиксель экрана каждый кадр; на 125% - 24.
 */
export function marqueeSpeed(dpr: number): number {
  const ratio = ratioOf(dpr);
  const framesPerPixel = Math.max(1, Math.round(HZ / (TARGET_SPEED * ratio)));
  return HZ / framesPerPixel / ratio;
}

/**
 * Круг ленты в пикселях экрана и в CSS-пикселях.
 *
 * Ширина половины меряется по тексту и выходит дробной. Круг берём целым
 * числом пикселей экрана: иначе ступени не совпадают с пикселями, и лента
 * снова стоит между ними.
 */
export function marqueeSpan(width: number, dpr: number): { steps: number; css: number } {
  const ratio = ratioOf(dpr);
  const steps = Math.max(1, Math.round(width * ratio));
  return { steps, css: steps / ratio };
}

/** Сколько пути пройдено на круге за это время. */
export function travelled(ms: number, speed: number, span: number): number {
  if (!(span > 0) || !(speed > 0) || !Number.isFinite(ms)) return 0;
  const path = ((ms / 1000) * speed) % span;
  return path < 0 ? path + span : path;
}
