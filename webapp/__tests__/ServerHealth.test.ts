// Заслонка «сервер обновляется»: когда она честная, а когда пугает зря.
//
// Сайт отдаётся хостингом, API приходит туннелем с рабочего стола. Промах
// запроса значит либо лежащий сервер, либо один тяжёлый запрос, который не
// уложился в предел ожидания туннеля. Разница видна только самому серверу.

import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshHealth() {
  vi.resetModules();
  return import("@/lib/health");
}

describe("состояние сервера", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("один промах заслонкой не считается", async () => {
    const health = await freshHealth();
    health.setHealthProbe(async () => false);
    health.apiDown();
    expect(health.serverHealth()).toBe("up");
  });

  it("два промаха подряд на живом сервере терминал не закрывают", async () => {
    // Кластерная свеча на живой монете доходит до предела ожидания туннеля, и
    // Cloudflare отвечает за сервер 524. Сервер при этом на месте.
    const health = await freshHealth();
    const probe = vi.fn(async () => true);
    health.setHealthProbe(probe);

    health.apiDown();
    health.apiDown();
    await vi.waitFor(() => expect(probe).toHaveBeenCalled());

    expect(health.serverHealth()).toBe("up");
  });

  it("молчащий сервер закрывается заслонкой", async () => {
    const health = await freshHealth();
    health.setHealthProbe(async () => false);
    const seen: string[] = [];
    health.watchHealth((next) => seen.push(next));

    health.apiDown();
    health.apiDown();
    await vi.waitFor(() => expect(health.serverHealth()).toBe("down"));
    expect(seen).toEqual(["down"]);
  });

  it("ответ прокси за отсутствующим сервером считается молчанием", async () => {
    const health = await freshHealth();
    expect(health.isServerGone(502)).toBe(true);
    expect(health.isServerGone(524)).toBe(true);
    // Сервер на месте и ответил: и отказ в доступе, и ненайденный адрес.
    expect(health.isServerGone(401)).toBe(false);
    expect(health.isServerGone(404)).toBe(false);
  });
});
