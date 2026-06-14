// Хранение токенов в localStorage (MVP). В проде — httpOnly cookie (ТЗ §4.2).

const ACCESS = "nmnh_access";
const REFRESH = "nmnh_refresh";
const MENTOR = "nmnh_mentor";

export function setStudentTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS, access);
  localStorage.setItem(REFRESH, refresh);
}

export function getAccessToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(ACCESS);
}

export function setMentorToken(token: string) {
  localStorage.setItem(MENTOR, token);
}

export function getMentorToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(MENTOR);
}

export function logout() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

export function logoutMentor() {
  localStorage.removeItem(MENTOR);
}
