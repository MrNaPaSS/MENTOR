import { describe, expect, it } from "vitest";
import { publicAsset } from "@/lib/chat/assetUrl";

const API = "https://api.nmnh.trade";

describe("publicAsset", () => {
  it("подменяет внутренний адрес стола на адрес API", () => {
    expect(publicAsset("http://127.0.0.1:8000/abcDEF12_-x.jpg", API)).toBe(
      "https://api.nmnh.trade/abcDEF12_-x.jpg",
    );
    expect(publicAsset("http://localhost:8000/a1b2c3d4.jpg", `${API}/`)).toBe(
      "https://api.nmnh.trade/a1b2c3d4.jpg",
    );
  });

  it("публичный адрес оставляет как есть", () => {
    expect(publicAsset("https://s.nmnh.trade/a1b2c3d4.jpg", API)).toBe(
      "https://s.nmnh.trade/a1b2c3d4.jpg",
    );
  });

  it("не трогает хост, который только начинается с localhost", () => {
    expect(publicAsset("https://localhost.evil.io/x.jpg", API)).toBe("https://localhost.evil.io/x.jpg");
  });

  it("в разработке на локальном API адрес не меняет", () => {
    expect(publicAsset("http://127.0.0.1:8000/a.jpg", "http://localhost:8000")).toBe(
      "http://127.0.0.1:8000/a.jpg",
    );
  });

  it("пустое остаётся пустым", () => {
    expect(publicAsset(undefined, API)).toBe("");
    expect(publicAsset("", API)).toBe("");
  });
});
