// Маркет: на что тратить монеты NMNH - функции платформы, менторство, наш софт.

export const shop = {
  title: "Маркет",
  hint: "На что потратить монеты NMNH",

  tabs: {
    features: "Функции",
    people: "Менторство",
    software: "Наш софт",
  },
  tabHints: {
    features: "Включаются сразу после покупки",
    people: "Выдаёт ментор вручную",
    software: "Наши продукты и доступ к индикаторам",
  },
  empty: "Здесь пока пусто.",

  balance: "Баланс",
  waiting: (n: number) => `Ждут получения: ${n}`,
  claim: "Забрать",
  earnTitle: "Как заработать",
  earnLines: [
    "Плюсовая сделка: +10",
    "Серия 3, 5 и 10 плюсов подряд: +15, +30, +100",
    "Убыток: −5",
    "Достижения, уровни и уроки академии",
    "За сделки не больше 150 в день",
  ],
  historyTitle: "История начислений",
  historyEmpty: "Начислений пока не было.",

  accessTitle: "Мои доступы",
  accessEmpty: "Купленные функции появятся здесь.",
  forever: "навсегда",
  until: (date: string) => `до ${date}`,
  chargesLeft: (n: number) => `зарядов: ${n}`,

  terms: {
    forever: "Навсегда",
    days: (n: number) => `На ${n} дн.`,
    charges: (n: number) => `Зарядов: ${n}`,
    instant: "Включается сразу",
    manual: "Выдаёт ментор",
  },

  buy: "Купить",
  extend: "Продлить",
  buyMore: "Купить ещё",
  bought: "Куплено",
  notEnough: (n: string) => `Не хватает ${n}`,
  details: "Подробнее",
  openLink: "Открыть",
  soon: "Скоро",

  indicatorsTitle: "Индикаторы TradingView",
  indicatorsHint: "Доступ выдаёт ментор на ваш ник TradingView",

  ordersSection: "Мои заказы",
  status: {
    pending: "Ожидает выдачи",
    fulfilled: "Выполнен",
    rejected: "Отклонён (возврат)",
  },

  confirmTitle: "Покупка",
  confirmFor: "за",
  confirmInstant: "Доступ включится сразу после покупки.",
  confirmNote: "Монеты спишутся сразу, ментор выдаст доступ вручную.",
  after: (n: string) => `После покупки останется ${n} NMNH`,
  tvLabel: "Ваш ник TradingView (обязательно для выдачи доступа)",
  contactLabel: "Контакт для связи (Telegram / email)",
  tvPlaceholder: "Ваш username на TradingView",
  tvHint: "Доступ к индикатору выдаётся на этот аккаунт TradingView.",
  buying: "Покупка…",
  buyError: "Ошибка покупки",
  done: (title: string) => `Готово: «${title}» включено.`,
  doneManual: (title: string) => `Заказ «${title}» принят, ментор выдаст доступ.`,

  features: {
    streak_freeze: "Заморозка серии",
    streak_boost: "Удвоение бонуса за серию",
    journal_export: "Выгрузка журнала в CSV",
  } as Record<string, string>,
};
