// Вкладка, которую давно не видно.
//
// Терминал на втором устройстве или в свёрнутом окне продолжал работать как
// открытый: опрашивал свечи, кластерную свечу и позиции и держал канал
// стакана, по которому сервер собирал и слал ему кадр восемь раз в секунду.
// Смотреть на это было некому, а процесс сервера у всех учеников один.
//
// Не сразу, а через минуту: вкладки переключают постоянно, и рвать канал на
// каждое переключение значило бы заставлять сервер отпускать и заново
// собирать стакан монеты - это запросы к бирже и пустой стакан на секунду при
// возврате. Минута отделяет «отвлёкся» от «ушёл».
//
// Вернулись - всё просыпается сразу, чтобы первое, что человек увидит, не было
// устаревшим.

/** Сколько вкладку не видно, прежде чем она считается простаивающей. */
export const IDLE_AFTER_MS = 60_000;

let hiddenSince: number | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
const idleListeners = new Set<() => void>();
const backListeners = new Set<() => void>();

function hidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/** Не видно дольше минуты. */
export function tabIdle(now: number = Date.now()): boolean {
  return hidden() && hiddenSince !== null && now - hiddenSince >= IDLE_AFTER_MS;
}

function onVisibility(): void {
  if (hidden()) {
    hiddenSince = Date.now();
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (tabIdle()) idleListeners.forEach((fn) => fn());
    }, IDLE_AFTER_MS);
    return;
  }
  // Будим только тех, кого усыпляли: короткое переключение вкладок никого
  // не останавливало, и дёргать их запросами при возврате незачем.
  const wasIdle = hiddenSince !== null && Date.now() - hiddenSince >= IDLE_AFTER_MS;
  hiddenSince = null;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (wasIdle) backListeners.forEach((fn) => fn());
}

function install(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  if (document.hidden) hiddenSince = Date.now();
  document.addEventListener("visibilitychange", onVisibility);
}

/** Вкладка ушла в простой. Возвращает отписку. */
export function onTabIdle(fn: () => void): () => void {
  install();
  idleListeners.add(fn);
  return () => {
    idleListeners.delete(fn);
  };
}

/** Вкладка вернулась из простоя. Возвращает отписку. */
export function onTabBack(fn: () => void): () => void {
  install();
  backListeners.add(fn);
  return () => {
    backListeners.delete(fn);
  };
}

/** Забыть всё. Нужно тестам. */
export function resetIdleTab(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  hiddenSince = null;
  idleListeners.clear();
  backListeners.clear();
  if (installed && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
  }
  installed = false;
}
