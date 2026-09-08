// Подписи, которые собираются в форматтерах значений.

export const format = {
  modeModerate: "УМЕРЕННЫЙ",
  modeTurbo: "ТУРБО",

  ago: {
    never: "никогда",
    now: "только что",
    minutes: (n: number) => `${n} мин назад`,
    hours: (n: number) => `${n} ч назад`,
    yesterday: "вчера",
    days: (n: number) => `${n} дн назад`,
    months: (n: number) => `${n} мес назад`,
    years: (n: number) => `${n} г назад`,
  },

  source: {
    academy: "академия",
    web: "сайт",
    bot: "бот",
  },
};
