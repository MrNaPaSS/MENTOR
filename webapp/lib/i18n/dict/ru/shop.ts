// Маркет: на что тратить монеты NMNH - функции платформы, оформление,
// менторство, наш софт.

export const shop = {
  title: "Маркет",
  hint: "На что потратить монеты NMNH",

  cats: {
    all: "Все",
    features: "Функции",
    frames: "Оформление",
    merch: "Мерч",
    software: "Наш софт",
  },
  empty: "Здесь пока пусто.",

  balance: "Баланс",
  waiting: (n: number) => `Ждут получения: ${n}`,
  claim: "Забрать",
  goal: (title: string, n: string) => `До «${title}» осталось ${n}`,
  earnToggle: "Как заработать",
  earnLines: [
    "Плюсовая сделка: +10",
    "Серия 3, 5 и 10 плюсов подряд: +15, +30, +100",
    "Убыток: −5",
    "Достижения, уровни и уроки академии",
    "За сделки не больше 150 в день",
  ],

  activity: {
    access: "Доступы",
    history: "История",
    orders: "Заказы",
  },
  historyEmpty: "Начислений пока не было.",
  accessEmpty: "Купленные функции и рамки появятся здесь.",
  ordersEmpty: "Заказов пока не было.",
  forever: "навсегда",
  until: (date: string) => `до ${date}`,
  chargesLeft: (n: number) => `зарядов: ${n}`,

  terms: {
    forever: "Навсегда",
    days: (n: number) => `На ${n} дн.`,
    charges: (n: number) => `Зарядов: ${n}`,
    instant: "Включается сразу",
    manual: "Выдаёт ментор",
    delivery: "Доставка",
    free: "Бесплатно",
  },

  pick: {
    colorLabel: "Цвет",
    sizeLabel: "Размер",
    color: (value: string) => `Цвет: ${value}`,
    size: (value: string) => `Размер: ${value}`,
    addressLabel: "Telegram и адрес доставки",
    addressPlaceholder: "@username, город, улица, дом, квартира, индекс",
  },

  buy: "Купить",
  extend: "Продлить",
  buyMore: "Купить ещё",
  bought: "Куплено",
  notEnough: (n: string) => `Не хватает ${n}`,
  saved: (n: string) => `Накоплено ${n}%`,
  details: "Подробнее",
  openLink: "Открыть",
  soon: "Скоро",

  equip: "Надеть",
  equipped: "Надето",
  unequip: "Снять",
  yourPreview: "Так будет у вас",
  rankOnly: (n: number) => `Даётся за ${n} место в лидерборде. Не продаётся.`,
  rankLock: (n: number) => `Топ-${n}`,

  status: {
    pending: "Ожидает выдачи",
    fulfilled: "Выполнен",
    rejected: "Отклонён (возврат)",
  },

  confirmTitle: "Покупка",
  confirmFor: "за",
  confirmInstant: "Доступ включится сразу после покупки.",
  confirmNote: "Монеты спишутся сразу, ментор выдаст доступ вручную.",
  confirmMerch: "Монеты спишутся сразу. Ментор свяжется с вами и отправит заказ по адресу.",
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
    frame_neon: "Рамка «Неон»",
    frame_carbon: "Рамка «Карбон»",
    frame_pulse: "Рамка «Пульс»",
    frame_candles: "Рамка «Свечи»",
    frame_crown: "Рамка «Корона»",
  } as Record<string, string>,

  rankFrames: {
    gold: "Рамка «Золото»",
    silver: "Рамка «Серебро»",
    bronze: "Рамка «Бронза»",
  } as Record<string, string>,
};
