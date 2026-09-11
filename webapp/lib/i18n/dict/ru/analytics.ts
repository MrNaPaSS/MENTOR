// Аналитика и прогресс: календарь, цели месяца, уровень и достижения.

export const analytics = {

  /** Вкладки раздела: торговля отдельно, игра вокруг неё отдельно. */
  tabs: { results: "Итоги", rewards: "Награды" },
  title: "Аналитика",
  titleAnd: "&",
  titleTail: "Прогресс",
  subtitle: "Реальные данные по закрытым сделкам, сигналам и обороту",
  totalVolume: "Всего объёма",

  kpi: {
    monthVolume: "Объём месяца",
    monthVolumeGoal: "цель: 250K",
    streak: "Стрик активности",
    streakGoal: "цель: 7 дней",
    avgDaily: "Ср. доходность/день",
    overDays: (n: number) => `за ${n} дней`,
    tradingDays: "Дней торговали",
    tradingDaysGoal: "цель: 15 дней",
  },

  /** Две панели цифр под показателями: как прошёл месяц и что со счётом. */
  month: {
    title: "Месяц в цифрах",
    hint: "по журналу сделок",
    trades: "сделок",
    profitDays: "прибыльных дней",
    ofTrading: (n: number) => `из ${n} торговых`,
    result: "итог месяца",
    best: "лучший день",
    worst: "худший день",
    perDay: "оборот в день",
    empty: "В этом месяце сделок ещё нет",
  },

  account: {
    title: "Счёт и издержки",
    hint: "по данным биржи",
    futures: "фьючерсы",
    spot: "спот",
    commission: "комиссия",
    ofVolume: (pct: string) => `${pct}% от оборота`,
    deposits: "пополнено",
    withdrawals: "выведено",
    net: "чистый ввод",
    empty: "Биржа ещё не отдала цифры по счёту",
  },

  /** Девизы у картинок раздела: две строки, набраны разрядкой. */
  mottos: {
    calendar: ["Маленькие шаги", "большие результаты"],
    month: ["Анализ сегодня", "профит завтра"],
    account: ["Больше данных", "больше возможностей"],
  },

  path: {
    title: "Путь трейдера",
    subtitle: "Суммарный объём на WEEX",
    toNext: "до",
    left: "осталось",
    pctToNext: (pct: string) => `${pct}% до следующей вехи`,
  },

  milestones: {
    m50k: "Старт",
    m100k: "Набираю обороты",
    m500k: "Серьёзный",
    m1m: "Миллионер",
    m5m: "Легенда NMNH",
    m10m: "К звёздам",
    m25m: "Элита",
  },

  rarity: {
    common: "Обычная",
    rare: "Редкая",
    epic: "Эпическая",
    legendary: "Легендарная",
  },

  calendar: {
    /** Заголовок окна, которое открывается нажатием по дню. */
    dayTitle: "День в разборе",
    dayCard: "Карточка за день",
    deposit: "Депозит",
    volume: (amount: string) => `Объём $${amount}`,
    profitDays: (n: number) => `↑ ${n} в плюс`,
    lossDays: (n: number) => `↓ ${n} в минус`,
    tradeDays: (n: number) => `↕ ${n} сделок`,
    signalDays: (n: number) => `⚡ ${n} сигналов`,
    legendSignal: "Сигнал",
    legendTrade: "Сделка",
    legendDeposit: "Депозит",
    legendGoal: "Цель",
    daySignals: (n: number) => `⚡ ${n} сигналов`,
    dayVolume: (amount: string) => `↕ $${amount} объём`,
    dayTrades: (n: number) => {
      const tail = n % 100 >= 11 && n % 100 <= 14 ? 0 : n % 10;
      const word = tail === 1 ? "сделка" : tail >= 2 && tail <= 4 ? "сделки" : "сделок";
      return `${n} ${word}`;
    },
    dayDeposit: "+$ Пополнение",
    dayGoal: "✓ Цель",
    noSnapshot: "Нет снимка",
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    months: [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ],
  },

  trades: {
    time: "Время",
    coin: "Монета",
    entry: "Вход",
    exit: "Выход",
    result: "Итог",
    long: "лонг",
    short: "шорт",
    cardTitle: "Карточка сделки: скопировать, скачать, поделиться",
    none: "Сделок в этот день не было",
  },

  summary: {
    monthResult: "итог месяца",
    bestDay: "лучший день",
    worstDay: "худший день",
    cardFor: "Карточка за",
    nothingToShow: "За этот срок нечего показать",
    spanDay: "день",
    spanWeek: "неделю",
    spanMonth: "месяц",
  },

  level: {
    title: "Уровень трейдера",
    short: "ур.",
    toNext: (xp: string, level: number) => `осталось ${xp} XP до ур. ${level}`,
    totalXp: "всего XP",
    titles: {
      1: "Новичок",
      2: "Начинающий",
      3: "Трейдер",
      4: "Уверенный",
      5: "Опытный",
      7: "Профи",
      10: "Эксперт",
      15: "Мастер",
      20: "Легенда",
    } as Record<number, string>,
    sources: {
      volume: "Объём",
      streak: "Стрик",
      hotDays: "Горячие дни",
      profit: "Прибыль",
      days: "Дни",
      goals: "Цели",
    },
  },

  goalsTitle: "Цели месяца",

  goals: {
    volume: { label: "Объём за месяц", unit: "USDT", reward: "💹 Активный трейдер" },
    trading_days: { label: "Дней торговали", unit: "дней", reward: "📅 Дисциплина" },
    profit: { label: "Прибыльных дней", unit: "дней в плюс", reward: "📈 Бычий режим" },
    streak: { label: "Стрик активности", unit: "дней подряд", reward: "🔥 На волне" },
    hot_day: { label: "Горячий день", unit: "дней 3%+", reward: "🌟 День охотника" },
    month_profit: { label: "Месяц в плюс", unit: "", reward: "📈 Победный месяц" },
  },

  achievements: {
    title: "Достижения",
    categories: {
      all: "Все",
      volume: "Объём",
      discipline: "Дисциплина",
      performance: "Результаты",
      deposit: "Депозиты",
      special: "Особые",
    },
    items: {
      vol_10k: { title: "Первые 10K", desc: "Суммарный объём 10 000 USDT" },
      vol_50k: { title: "Старт", desc: "Суммарный объём 50 000 USDT" },
      vol_100k: { title: "Набираю обороты", desc: "Суммарный объём 100 000 USDT" },
      vol_500k: { title: "Серьёзный", desc: "Суммарный объём 500 000 USDT" },
      vol_1m: { title: "Миллионер", desc: "Суммарный объём 1 000 000 USDT" },
      vol_5m: { title: "Легенда NMNH", desc: "Суммарный объём 5 000 000 USDT" },
      vol_10m: { title: "К звёздам", desc: "Суммарный объём 10 000 000 USDT" },
      vol_25m: { title: "Элита", desc: "Суммарный объём 25 000 000 USDT" },

      first_trade: { title: "Первый шаг", desc: "Первый торговый день" },
      streak_3: { title: "Трёхдневка", desc: "3 дня активности подряд" },
      streak_7: { title: "Недельный стрик", desc: "7 дней активности подряд" },
      streak_14: { title: "Двухнедельник", desc: "14 дней активности подряд" },
      streak_30: { title: "Железный трейдер", desc: "30 дней активности подряд" },
      days_15: { title: "Полмесяца", desc: "15 торговых дней в месяце" },
      days_20: { title: "Настоящий трейдер", desc: "20 торговых дней в месяце" },
      days_25: { title: "Профессионал", desc: "25 торговых дней в месяце" },

      first_profit: { title: "Первый плюс", desc: "Первый прибыльный день" },
      profit_5: { title: "5 побед", desc: "5 прибыльных дней в месяце" },
      profit_10: { title: "10 побед", desc: "10 прибыльных дней в месяце" },
      hot_day_3: { title: "Горячий день", desc: "День с прибылью 3%+" },
      hot_day_5: { title: "Раскалённый день", desc: "День с прибылью 5%+" },
      hot_day_10: { title: "Снайпер", desc: "День с прибылью 10%+" },
      month_plus: { title: "Месяц в плюс", desc: "Средний PnL месяца положительный" },
      goal_days_10: { title: "Ударник", desc: "10 дней с выполненными целями" },

      dep_first: { title: "Первый депозит", desc: "Первое пополнение счёта" },
      dep_500: { title: "Инвестор", desc: "Пополнения от 500 USDT" },
      dep_1k: { title: "Серьёзный капитал", desc: "Пополнения от 1 000 USDT" },
      dep_5k: { title: "Фонд менеджер", desc: "Пополнения от 5 000 USDT" },
      dep_10k: { title: "Кит", desc: "Пополнения от 10 000 USDT" },
      dep_3plus: { title: "Регулярный", desc: "3 и более пополнений" },

      joined: { title: "Добро пожаловать", desc: "Вступил в сообщество NMNH" },
      level_5: { title: "Уровень 5", desc: "Достигни уровня трейдера 5" },
      level_10: { title: "Уровень 10", desc: "Достигни уровня трейдера 10" },
      level_20: { title: "Уровень 20", desc: "Достигни уровня трейдера 20" },
      all_goals: { title: "Перфекционист", desc: "Выполни все цели месяца" },
      vol_250k_mo: { title: "Месячный рекорд", desc: "Объём за месяц 250K USDT" },
    },
  },
};
