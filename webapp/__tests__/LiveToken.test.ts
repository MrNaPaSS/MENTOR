import { afterEach, describe, expect, it, vi } from "vitest";

import { liveAccessToken } from "@/lib/api";
import { logout, setStudentTokens } from "@/lib/auth";

// Сокет чата уходит с токеном в адресе и на отказ сам его не обновит. Ученик с
// истёкшим токеном получал 403 раз за разом, пока не перезагрузил страницу.

function jwt(exp: number): string {
  const part = (claims: object) =>
    btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "1", exp })}.signature`;
}

const now = () => Math.floor(Date.now() / 1000);

afterEach(() => {
  logout();
  vi.unstubAllGlobals();
});

describe("живой токен", () => {
  it("живой отдаётся как есть, без похода на сервер", async () => {
    const token = jwt(now() + 600);
    setStudentTokens(token, "refresh-1");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await liveAccessToken()).toBe(token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("истёкший обновляется", async () => {
    setStudentTokens(jwt(now() - 3600), "refresh-1");
    const fresh = jwt(now() + 900);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: fresh, refresh_token: "refresh-2" }),
      })),
    );

    expect(await liveAccessToken()).toBe(fresh);
  });

  it("без входа - пусто", async () => {
    expect(await liveAccessToken()).toBeNull();
  });
});
