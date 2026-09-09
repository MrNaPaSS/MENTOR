// Хранение токенов в localStorage (MVP). В проде - httpOnly cookie (ТЗ §4.2).
//
// Access-токен живёт 15 минут, refresh - 30 дней. Токены нужны оба: без refresh
// вкладку выбрасывало из кабинета через четверть часа и при каждом перезаходе.

const ACCESS = "nmnh_access";
const REFRESH = "nmnh_refresh";
const MENTOR = "nmnh_mentor";
const MENTOR_REFRESH = "nmnh_mentor_refresh";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    // Приватный режим или запрет на хранилище - ведём себя как незалогиненные.
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Записать не вышло - вход проживёт до перезагрузки страницы, но не упадёт.
  }
}

function drop(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ничего не делаем */
  }
}

export type TokenKind = "student" | "mentor";

/**
 * Токены, которые уже сменились.
 *
 * Access-токен живёт четверть часа, и обновляется он посреди работы: запрос
 * получил 401, клиент сходил за новым и повторил. В localStorage при этом
 * лежит уже новый токен, а в React-состоянии открытых страниц - старый: они о
 * подмене не знают. Следующий запрос уходит со старым, снова получает 401, и
 * вот тут прежний код сдавался: владельца токена он искал сравнением с тем,
 * что лежит в хранилище, не находил и возвращал ошибку наверх. Ученики и
 * дашборд в админке оставались пустыми до перезагрузки страницы - после неё
 * состояние набиралось из хранилища заново и всё работало.
 *
 * Поэтому помним несколько последних отставных токенов: по ним видно, чей это
 * вход, и такой запрос можно обновить и повторить, как любой другой.
 */
const retired = new Map<string, TokenKind>();
const RETIRED_MAX = 8;

function retire(token: string | null, kind: TokenKind) {
  if (!token) return;
  retired.set(token, kind);
  // Помним немного: это защита от пары запросов, разминувшихся с обновлением,
  // а не журнал всех входов за сессию.
  while (retired.size > RETIRED_MAX) {
    const oldest = retired.keys().next();
    if (oldest.done) break;
    retired.delete(oldest.value);
  }
}

/** Чей это access-токен - ученика или наставника. Отставные тоже узнаём. */
export function tokenKind(token: string): TokenKind | null {
  if (!token) return null;
  if (token === read(MENTOR)) return "mentor";
  if (token === read(ACCESS)) return "student";
  return retired.get(token) ?? null;
}

// Кто хочет знать о смене токенов.
//
// Обновлённый токен обязан доехать до страниц, а не только до хранилища:
// иначе они продолжают ходить со старым и живут прошлым до перезагрузки.
type Listener = () => void;
const listeners = new Set<Listener>();
let watchingStorage = false;

function announce() {
  for (const listener of [...listeners]) listener();
}

/**
 * Подписка на смену входа: вернувшуюся функцию вызывают при размонтировании.
 *
 * Слушаем и соседние вкладки: вход или выход в одной из них - это тот же вход
 * или выход и здесь, а `storage` браузер шлёт только чужим вкладкам.
 */
export function onTokensChange(listener: Listener): () => void {
  listeners.add(listener);
  if (!watchingStorage && typeof window !== "undefined") {
    watchingStorage = true;
    window.addEventListener("storage", announce);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function setStudentTokens(access: string, refresh: string) {
  retire(read(ACCESS), "student");
  write(ACCESS, access);
  write(REFRESH, refresh);
  announce();
}

export function getAccessToken(): string | null {
  return read(ACCESS);
}

export function getRefreshToken(): string | null {
  return read(REFRESH);
}

export function setMentorToken(token: string, refresh?: string | null) {
  retire(read(MENTOR), "mentor");
  write(MENTOR, token);
  if (refresh) write(MENTOR_REFRESH, refresh);
  announce();
}

export function getMentorToken(): string | null {
  return read(MENTOR);
}

export function getMentorRefreshToken(): string | null {
  return read(MENTOR_REFRESH);
}

export function logout() {
  drop(ACCESS);
  drop(REFRESH);
  announce();
}

export function logoutMentor() {
  drop(MENTOR);
  drop(MENTOR_REFRESH);
  announce();
}
