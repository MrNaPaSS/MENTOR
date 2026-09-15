import { describe, it, expect } from "vitest";
import { errorText } from "@/lib/api";

// Отказ сервера на экране. На проверке полей FastAPI отдаёт `detail` списком
// объектов, и список уходил в текст как есть: «Биржа не приняла заявку
// [object Object]».

describe("текст отказа сервера", () => {
  it("строку отдаёт как есть", () => {
    expect(errorText({ detail: "Сначала подключите ключи" }, 409)).toBe("Сначала подключите ключи");
  });

  it("список ошибок проверки превращает в слова, а не в [object Object]", () => {
    const body = {
      detail: [
        {
          type: "less_than_equal",
          loc: ["body", "leverage"],
          msg: "Input should be less than or equal to 400",
          input: 500,
        },
      ],
    };
    const text = errorText(body, 422);
    expect(text).not.toContain("[object Object]");
    expect(text).toBe("leverage: Input should be less than or equal to 400");
  });

  it("несколько ошибок - через точку с запятой", () => {
    const body = {
      detail: [
        { loc: ["body", "leverage"], msg: "too high" },
        { loc: ["body", "stop"], msg: "required" },
      ],
    };
    expect(errorText(body, 422)).toBe("leverage: too high; stop: required");
  });

  it("объект с сообщением - берёт сообщение", () => {
    expect(errorText({ detail: { message: "Счёт занят" } }, 409)).toBe("Счёт занят");
  });

  it("без понятного текста - код ответа", () => {
    expect(errorText({}, 502)).toBe("HTTP 502");
    expect(errorText(null, 500)).toBe("HTTP 500");
    expect(errorText({ detail: { code: 7 } }, 409)).toBe("HTTP 409");
  });
});
