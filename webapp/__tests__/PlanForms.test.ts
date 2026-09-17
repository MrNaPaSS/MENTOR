/**
 * Формы плана недели: разбор сохранённого текста и сборка обратно.
 *
 * План лежит на сервере одной строкой, а показывается формой. Значит, текст
 * должен разбираться на разделы и собираться из них без потерь - иначе
 * перелистнутая заготовка съест работу, которую человек уже сделал.
 */

import { describe, it, expect } from "vitest";

import { PLAN_FORMS, buildPlan, formById, parsePlan } from "@/lib/planForms";

const TITLES: Record<string, string> = {
  goals: "Цели",
  trade: "Что торгую",
  rules: "По каким правилам",
  avoid: "Чего не делаю",
  risk: "Риск на сделку",
  dayStop: "Стоп на день",
  count: "Сколько сделок",
  hours: "Когда торгую",
  fails: "Что не получилось",
  repeat: "Что повторяю",
  habit: "Привычка недели",
  free: "Своими словами",
};

describe("формы плана", () => {
  it("собранный план разбирается обратно теми же разделами", () => {
    const text = buildPlan(
      formById("week"),
      { goals: "три сделки в день", rules: "вход только по сессии" },
      TITLES,
    );
    const seen = parsePlan(text);
    expect(seen.form).toBe("week");
    expect(seen.values.goals).toBe("три сделки в день");
    expect(seen.values.rules).toBe("вход только по сессии");
    // Пустой раздел остаётся каркасом и пустым же читается.
    expect(seen.values.avoid).toBe("");
  });

  it("многострочный раздел не теряет строк", () => {
    const body = "- не усредняю\n- не вхожу после двух стопов";
    const text = buildPlan(formById("week"), { avoid: body }, TITLES);
    expect(parsePlan(text).values.avoid).toBe(body);
  });

  it("разделы чужой заготовки сохраняются вместе с планом", () => {
    // Человек заполнил лимиты, потом перелистнул на план недели.
    const text = buildPlan(
      formById("week"),
      { goals: "спокойная неделя", dayStop: "-2%" },
      TITLES,
    );
    const seen = parsePlan(text);
    expect(seen.values.dayStop).toBe("-2%");
    expect(seen.form).toBe("week");
  });

  it("узнаёт заготовку по значкам разделов, а не по языку", () => {
    const text = "💰 Risk per trade\n1%\n\n🛑 Daily stop\n-3%\n";
    const seen = parsePlan(text);
    expect(seen.form).toBe("risk");
    expect(seen.values.risk).toBe("1%");
  });

  it("старый план без разделов открывается свободной формой", () => {
    const seen = parsePlan("торгую BTC и ETH, стоп за структуру");
    expect(seen.form).toBe("free");
    expect(seen.values.free).toBe("торгую BTC и ETH, стоп за структуру");
  });

  it("свободная форма пишет только свой текст", () => {
    const text = buildPlan(formById("free"), { free: "как пойдёт" }, TITLES);
    expect(text).toBe("как пойдёт");
  });

  it("незнакомое имя заготовки даёт план недели", () => {
    expect(formById("что-то").id).toBe(PLAN_FORMS[0].id);
  });
});
