import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("calculate posts JSON and parses response", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ leverage: 10, margin_usd: "80", take_profits: [] }),
    });
    vi.stubGlobal("fetch", mock);

    const res = await api.calculate({
      mode: "moderate",
      balance: "1000",
      entry_price: "100",
      direction: "LONG",
      leverage: 10,
    });

    expect(res.leverage).toBe(10);
    expect(mock).toHaveBeenCalledTimes(1);
    const [, init] = mock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).balance).toBe("1000");
  });

  it("publicStats does a GET and returns data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ total_signals: 5, active_signals: 2, active_students: 3, winrate: null }),
      })
    );
    const res = await api.publicStats();
    expect(res.total_signals).toBe(5);
  });

  it("throws with detail on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: "bad input" }) })
    );
    await expect(api.publicStats()).rejects.toThrow("bad input");
  });

  it("requestCode hits auth endpoint", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, detail: "sent", code: "123456" }),
    });
    vi.stubGlobal("fetch", mock);
    const res = await api.requestCode("999");
    expect(res.code).toBe("123456");
    expect(mock.mock.calls[0][0]).toContain("/api/auth/request-code");
  });

  it("profile sends Authorization header", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, mode: "moderate", language: "ru" }),
    });
    vi.stubGlobal("fetch", mock);
    await api.profile("tok123");
    expect(mock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok123");
  });

  it("createSignal posts text+audience with auth", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ signal: { id: 1 }, deliveries: [] }),
    });
    vi.stubGlobal("fetch", mock);
    await api.createSignal("mtok", "XLM LONG", "all");
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain("/api/signals");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer mtok");
    expect(JSON.parse(init.body).audience).toBe("all");
  });

  it("mentorLogin passes password in query", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "a", refresh_token: "r" }),
    });
    vi.stubGlobal("fetch", mock);
    await api.mentorLogin("p@ss word");
    expect(mock.mock.calls[0][0]).toContain("password=p%40ss%20word");
  });
});
