import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setStudentTokens,
  setMentorToken,
  getAccessToken,
  getRefreshToken,
  getMentorToken,
  getMentorRefreshToken,
  logout,
  logoutMentor,
} from "@/lib/auth";
import { fmtAgo, fmtDateTime, sourceLabel } from "@/lib/format";

describe("хранение токенов", () => {
  beforeEach(() => localStorage.clear());

  it("сохраняет и отдаёт пару токенов ученика", () => {
    setStudentTokens("a1", "r1");
    expect(getAccessToken()).toBe("a1");
    expect(getRefreshToken()).toBe("r1");
  });

  it("хранит refresh ментора — иначе админку выбрасывает через 15 минут", () => {
    setMentorToken("ma", "mr");
    expect(getMentorToken()).toBe("ma");
    expect(getMentorRefreshToken()).toBe("mr");
  });

  it("не затирает refresh ментора, если его не передали", () => {
    setMentorToken("ma", "mr");
    setMentorToken("ma2");
    expect(getMentorRefreshToken()).toBe("mr");
  });

  it("выход чистит обе половины пары", () => {
    setStudentTokens("a1", "r1");
    logout();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("выход ментора не трогает вход ученика", () => {
    setStudentTokens("a1", "r1");
    setMentorToken("ma", "mr");
    logoutMentor();
    expect(getMentorToken()).toBeNull();
    expect(getAccessToken()).toBe("a1");
  });

  it("переживает недоступное хранилище вместо падения", () => {
    // Приватный режим: localStorage бросает при доступе.
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("доступ запрещён");
    });
    expect(getAccessToken()).toBeNull();
    spy.mockRestore();
  });
});

describe("обновление токена вместо разлогина", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Первый ответ — 401, дальше по очереди из списка. */
  function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let i = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)];
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body ?? {},
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  it("на 401 обновляет токен и повторяет запрос", async () => {
    setStudentTokens("старый", "refresh-1");
    const calls = mockFetch([
      { status: 401 },
      { status: 200, body: { access_token: "новый", refresh_token: "refresh-2" } },
      { status: 200, body: { id: 1 } },
    ]);

    const { api } = await import("@/lib/api");
    const profile = await api.profile("старый");

    expect(profile).toEqual({ id: 1 });
    expect(calls[1].url).toContain("/api/auth/refresh");
    // Повтор ушёл уже со свежим токеном
    expect((calls[2].init?.headers as Record<string, string>)["Authorization"])
      .toBe("Bearer новый");
    // Обновлённая пара сохранена — следующий перезаход её подхватит
    expect(getAccessToken()).toBe("новый");
    expect(getRefreshToken()).toBe("refresh-2");
  });

  it("не ходит за обновлением, когда refresh-токена нет", async () => {
    localStorage.clear();
    const calls = mockFetch([{ status: 401 }]);

    const { api } = await import("@/lib/api");
    await expect(api.profile("чужой-токен")).rejects.toThrow();

    expect(calls).toHaveLength(1);
  });

  it("параллельные запросы обновляются одним вызовом", async () => {
    setStudentTokens("старый", "refresh-1");
    const calls = mockFetch([
      { status: 401 },
      { status: 401 },
      { status: 200, body: { access_token: "новый", refresh_token: "refresh-2" } },
      { status: 200, body: { ok: true } },
    ]);

    const { api } = await import("@/lib/api");
    await Promise.all([api.profile("старый"), api.profile("старый")]);

    const refreshCalls = calls.filter((c) => c.url.includes("/api/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe("форматирование времени входа", () => {
  const now = Date.parse("2026-07-28T12:00:00Z");

  it("пустое значение — «никогда», это и есть «не заходил»", () => {
    expect(fmtAgo(null, now)).toBe("никогда");
    expect(fmtAgo(undefined, now)).toBe("никогда");
  });

  it("считает минуты, часы и дни", () => {
    expect(fmtAgo("2026-07-28T11:30:00Z", now)).toBe("30 мин назад");
    expect(fmtAgo("2026-07-28T09:00:00Z", now)).toBe("3 ч назад");
    expect(fmtAgo("2026-07-27T12:00:00Z", now)).toBe("вчера");
    expect(fmtAgo("2026-07-23T12:00:00Z", now)).toBe("5 дн назад");
  });

  it("свежие и будущие метки не выглядят ошибкой", () => {
    expect(fmtAgo("2026-07-28T11:59:30Z", now)).toBe("только что");
    expect(fmtAgo("2026-07-28T12:05:00Z", now)).toBe("только что");
  });

  it("мусор не роняет таблицу", () => {
    expect(fmtAgo("не дата", now)).toBe("-");
    expect(fmtDateTime("не дата")).toBe("—");
    expect(fmtDateTime(null)).toBe("—");
  });

  it("подписывает источник записи по-русски", () => {
    expect(sourceLabel("academy")).toBe("академия");
    expect(sourceLabel("web")).toBe("сайт");
    expect(sourceLabel("bot")).toBe("бот");
  });
});
