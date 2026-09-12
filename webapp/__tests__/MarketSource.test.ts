import { describe, expect, it } from "vitest";
import { HOME_SOURCE, originMark, sourceName } from "@/lib/marketOrigin";

describe("originMark", () => {
  it("stays silent for live data from our own exchange", () => {
    expect(originMark({ source: HOME_SOURCE, stale: false }).show).toBe(false);
  });

  it("marks data served from the cache", () => {
    const mark = originMark({ source: "weex", stale: true });
    expect(mark.show).toBe(true);
    expect(mark.stale).toBe(true);
    expect(mark.source).toBe("weex");
  });

  it("marks a price that came from another exchange", () => {
    const mark = originMark({ source: "binance", stale: false });
    expect(mark.show).toBe(true);
    expect(mark.stale).toBe(false);
    expect(mark.mixed).toBe(false);
  });

  it("marks an answer assembled from several sources", () => {
    const mark = originMark({ source: "mixed", stale: false, sources: { price: "binance" } });
    expect(mark.mixed).toBe(true);
    expect(mark.show).toBe(true);
  });

  it("marks the absence of data", () => {
    expect(originMark({ source: null, stale: false })).toEqual({
      show: false,
      stale: false,
      source: null,
      mixed: false,
    });
  });

  it("survives a response without the fields at all (old backend)", () => {
    expect(originMark(undefined).show).toBe(false);
    expect(originMark({}).show).toBe(false);
  });

  it("takes the home source as an argument: panels of other markets differ", () => {
    expect(originMark({ source: "coingecko" }, "coingecko").show).toBe(false);
  });
});

describe("sourceName", () => {
  it("writes known sources the way people do", () => {
    expect(sourceName("weex")).toBe("WEEX");
    expect(sourceName("binance")).toBe("Binance");
  });

  it("shows an unknown source as it came", () => {
    expect(sourceName("kraken")).toBe("kraken");
  });

  it("has nothing to show for no source", () => {
    expect(sourceName(null)).toBe("");
  });
});
