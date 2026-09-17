/**
 * Снимки разбора: картинки, прикреплённые к сделке журнала.
 *
 * Самый частый способ сохранить, как всё выглядело, - снимок экрана в буфере:
 * нажал PrtSc, переключился в терминал, вставил. Поэтому вставка из буфера
 * проверяется отдельно, вместе с тем, что вставленный текст снимком не
 * притворяется.
 */

import { describe, it, expect, vi } from "vitest";

import { pastedImage, readImage, shotImage, shotPage } from "@/lib/journalShots";

vi.mock("@/lib/api", () => ({
  API_URL: "https://api.nmnh.trade",
  authReq: async () => null,
}));

/** Событие вставки с одним вложением. */
function paste(items: { type: string; file: File | null }[]): ClipboardEvent {
  return {
    clipboardData: {
      items: items.map((one) => ({
        type: one.type,
        getAsFile: () => one.file,
      })),
    },
  } as unknown as ClipboardEvent;
}

function png(name = "shot.png"): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}

describe("адреса снимка", () => {
  it("картинка и страница - разные адреса", () => {
    // Картинка нужна плитке в окне, страница - чтобы поделиться ссылкой.
    expect(shotImage({ shot_id: "abc123" })).toBe("https://api.nmnh.trade/abc123.png");
    expect(shotPage({ shot_id: "abc123" })).toBe("https://api.nmnh.trade/abc123");
  });
});

describe("вставка из буфера", () => {
  it("картинка из буфера превращается в data-URL", async () => {
    const image = await pastedImage(paste([{ type: "image/png", file: png() }]));
    expect(image).toMatch(/^data:image\/png/);
  });

  it("вставленный текст снимком не становится", async () => {
    // Иначе к сделке прикреплялась бы пустая картинка, и это заметили бы
    // только при разборе - когда смотреть уже нечего.
    const image = await pastedImage(paste([{ type: "text/plain", file: null }]));
    expect(image).toBeNull();
  });

  it("пустой буфер ничего не ломает", async () => {
    expect(await pastedImage(paste([]))).toBeNull();
  });
});

describe("файл с диска", () => {
  it("картинка читается в data-URL", async () => {
    expect(await readImage(png())).toMatch(/^data:image\/png/);
  });

  it("не картинку не берём", async () => {
    const text = new File(["отчёт"], "plan.txt", { type: "text/plain" });
    expect(await readImage(text)).toBeNull();
  });
});
