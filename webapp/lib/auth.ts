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

export function setStudentTokens(access: string, refresh: string) {
  write(ACCESS, access);
  write(REFRESH, refresh);
}

export function getAccessToken(): string | null {
  return read(ACCESS);
}

export function getRefreshToken(): string | null {
  return read(REFRESH);
}

export function setMentorToken(token: string, refresh?: string | null) {
  write(MENTOR, token);
  if (refresh) write(MENTOR_REFRESH, refresh);
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
}

export function logoutMentor() {
  drop(MENTOR);
  drop(MENTOR_REFRESH);
}
