export const analytics = {

  /** Вкладки раздела: торговля отдельно, игра вокруг неё отдельно. */
  tabs: { results: "Results", advanced: "Advanced", rewards: "Rewards" },
  title: "Analytics",
  titleAnd: "&",
  titleTail: "Progress",
  subtitle: "Real data from closed trades, signals and volume",
  totalVolume: "Total volume",

  kpi: {
    monthVolume: "Volume this month",
    monthVolumeGoal: "goal: 250K",
    streak: "Activity streak",
    streakGoal: "goal: 7 days",
    avgDaily: "Avg return/day",
    overDays: (n: number) => (n === 1 ? "over 1 day" : `over ${n} days`),
    tradingDays: "Days traded",
    tradingDaysGoal: "goal: 15 days",
  },

  month: {
    title: "The month in numbers",
    hint: "from the trade journal",
    trades: "trades",
    profitDays: "green days",
    ofTrading: (n: number) => `of ${n} traded`,
    result: "month result",
    best: "best day",
    worst: "worst day",
    perDay: "volume per day",
    empty: "No trades this month yet",
  },

  account: {
    title: "Account and costs",
    hint: "from the exchange",
    futures: "futures",
    spot: "spot",
    commission: "fees",
    ofVolume: (pct: string) => `${pct}% of volume`,
    deposits: "deposited",
    withdrawals: "withdrawn",
    net: "net in",
    empty: "The exchange has not returned account numbers yet",
  },

  /** Mottos next to the section art: two lines, letter-spaced. */
  mottos: {
    calendar: ["Small steps", "big results"],
    month: ["Analysis today", "profit tomorrow"],
    account: ["More data", "more opportunities"],
  },

  path: {
    title: "Trader's path",
    subtitle: "Total volume on WEEX",
    toNext: "to",
    left: "left",
    pctToNext: (pct: string) => `${pct}% to the next milestone`,
  },

  milestones: {
    m50k: "Getting started",
    m100k: "Picking up speed",
    m500k: "Serious",
    m1m: "Millionaire",
    m5m: "NMNH legend",
    m10m: "To the stars",
    m25m: "Elite",
  },

  rarity: {
    common: "Common",
    rare: "Rare",
    epic: "Epic",
    legendary: "Legendary",
  },

  calendar: {
    /** Заголовок окна, которое открывается нажатием по дню. */
    dayTitle: "The day in detail",
    dayCard: "Card for the day",
    deposit: "Deposit",
    volume: (amount: string) => `Volume $${amount}`,
    profitDays: (n: number) => `↑ ${n} ${n === 1 ? "day" : "days"} up`,
    lossDays: (n: number) => `↓ ${n} ${n === 1 ? "day" : "days"} down`,
    monthTrades: (n: number) => `↕ ${n} ${n === 1 ? "trade" : "trades"}`,
    signalDays: (n: number) => `⚡ ${n} with signals`,
    legendSignal: "Signal",
    legendTrade: "Trade",
    legendDeposit: "Deposit",
    legendGoal: "Goal",
    daySignals: (n: number) => `⚡ ${n} signals`,
    dayVolume: (amount: string) => `↕ $${amount} volume`,
    dayTrades: (n: number) => `${n} ${n === 1 ? "trade" : "trades"}`,
    dayDeposit: "+$ Deposit",
    dayGoal: "✓ Goal",
    noSnapshot: "No snapshot",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    months: [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
  },

  trades: {
    time: "Time",
    coin: "Coin",
    entry: "Entry",
    exit: "Exit",
    result: "Result",
    long: "long",
    short: "short",
    cardTitle: "Trade card: copy, download, share",
    none: "No trades on this day",
  },

  summary: {
    monthResult: "month result",
    bestDay: "best day",
    worstDay: "worst day",
    cardFor: "Card for the",
    nothingToShow: "Nothing to show for this period",
    spanDay: "day",
    spanWeek: "week",
    spanMonth: "month",
  },

  level: {
    title: "Trader level",
    short: "lvl",
    toNext: (xp: string, level: number) => `${xp} XP to level ${level}`,
    totalXp: "total XP",
    titles: {
      1: "Rookie",
      2: "Beginner",
      3: "Trader",
      4: "Confident",
      5: "Experienced",
      7: "Pro",
      10: "Expert",
      15: "Master",
      20: "Legend",
    } as Record<number, string>,
    sources: {
      volume: "Volume",
      streak: "Streak",
      hotDays: "Hot days",
      profit: "Profit",
      days: "Days",
      goals: "Goals",
    },
  },

  goalsTitle: "Goals for the month",

  goals: {
    volume: { label: "Volume this month", unit: "USDT", reward: "💹 Active trader" },
    trading_days: { label: "Days traded", unit: "days", reward: "📅 Discipline" },
    profit: { label: "Profitable days", unit: "days up", reward: "📈 Bull mode" },
    streak: { label: "Activity streak", unit: "days in a row", reward: "🔥 On a roll" },
    hot_day: { label: "Hot day", unit: "days 3%+", reward: "🌟 Hunter's day" },
    month_profit: { label: "Month in the green", unit: "", reward: "📈 Winning month" },
  },

  achievements: {
    title: "Achievements",
    categories: {
      all: "All",
      volume: "Volume",
      discipline: "Discipline",
      performance: "Performance",
      deposit: "Deposits",
      special: "Special",
    },
    items: {
      vol_10k: { title: "First 10K", desc: "Total volume of 10,000 USDT" },
      vol_50k: { title: "Getting started", desc: "Total volume of 50,000 USDT" },
      vol_100k: { title: "Picking up speed", desc: "Total volume of 100,000 USDT" },
      vol_500k: { title: "Serious", desc: "Total volume of 500,000 USDT" },
      vol_1m: { title: "Millionaire", desc: "Total volume of 1,000,000 USDT" },
      vol_5m: { title: "NMNH legend", desc: "Total volume of 5,000,000 USDT" },
      vol_10m: { title: "To the stars", desc: "Total volume of 10,000,000 USDT" },
      vol_25m: { title: "Elite", desc: "Total volume of 25,000,000 USDT" },

      first_trade: { title: "First step", desc: "Your first trading day" },
      streak_3: { title: "Three in a row", desc: "3 active days in a row" },
      streak_7: { title: "Weekly streak", desc: "7 active days in a row" },
      streak_14: { title: "Two weeks strong", desc: "14 active days in a row" },
      streak_30: { title: "Iron trader", desc: "30 active days in a row" },
      days_15: { title: "Half a month", desc: "15 trading days in a month" },
      days_20: { title: "Real trader", desc: "20 trading days in a month" },
      days_25: { title: "Professional", desc: "25 trading days in a month" },

      first_profit: { title: "First green day", desc: "Your first profitable day" },
      profit_5: { title: "5 wins", desc: "5 profitable days in a month" },
      profit_10: { title: "10 wins", desc: "10 profitable days in a month" },
      hot_day_3: { title: "Hot day", desc: "A day with 3%+ profit" },
      hot_day_5: { title: "Red hot day", desc: "A day with 5%+ profit" },
      hot_day_10: { title: "Sniper", desc: "A day with 10%+ profit" },
      month_plus: { title: "Month in the green", desc: "Average monthly PnL is positive" },
      goal_days_10: { title: "Overachiever", desc: "10 days with goals completed" },

      dep_first: { title: "First deposit", desc: "Your first account top-up" },
      dep_500: { title: "Investor", desc: "Top-ups of 500 USDT or more" },
      dep_1k: { title: "Serious capital", desc: "Top-ups of 1,000 USDT or more" },
      dep_5k: { title: "Fund manager", desc: "Top-ups of 5,000 USDT or more" },
      dep_10k: { title: "Whale", desc: "Top-ups of 10,000 USDT or more" },
      dep_3plus: { title: "Regular", desc: "3 or more top-ups" },

      joined: { title: "Welcome", desc: "Joined the NMNH community" },
      level_5: { title: "Level 5", desc: "Reach trader level 5" },
      level_10: { title: "Level 10", desc: "Reach trader level 10" },
      level_20: { title: "Level 20", desc: "Reach trader level 20" },
      all_goals: { title: "Perfectionist", desc: "Complete every goal of the month" },
      vol_250k_mo: { title: "Monthly record", desc: "250K USDT volume in a month" },
    },
  },

  /** Advanced analytics: the trading journal, broken down. */
  advanced: {
    filters: "Slice",
    reset: "reset",
    loading: "crunching...",
    empty: "No trades in this period",
    export: "Export",
    days: (n: number) => (n >= 365 ? "year" : `${n} days`),
    tradesCount: (n: number) => `${n} ${n === 1 ? "trade" : "trades"}`,
    minutes: (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n} min`),
    sides: { all: "all", long: "long", short: "short" },
    measures: { pnl: "Profit", trades: "Trades" },

    /** Two screens of the section. */
    views: {
      title: "Screen",
      name: {
        overview: "Analytics",
        detail: "Detailed analytics",
      },
      hint: {
        overview: "the whole period at a glance",
        detail: "down to a single trade",
      },
    },

    total: {
      title: "Net",
      hint: "what it is made of",
      label: "net",
      short: "trades",
      wins: "Winners",
      losses: "Losers",
      fees: "Fees",
      all: "Trades total",
    },

    kpi: {
      net: "Net",
      winRate: "Win rate",
      profitFactor: "Profit factor",
      avgR: "Average R",
      avgRHint: "result in units of risk",
      drawdown: "Drawdown",
      fees: "Fees",
      feesHint: "both legs",
      avgWin: "Average win",
      hold: "In trade",
    },

    metrics: {
      title: "Metrics",
      hint: "over the selected trades",
      profitFactorNote: "wins over losses",
      expectancy: "Per trade",
      expectancyNote: "on average",
      avgLoss: (amount: string) => `average loss ${amount}`,
      avgLossLabel: "Average loss",
      ofGross: "of wins",
      holdNote: "average time",
      none: "none",
      versus: (net: string, winRate: string, pf: string) =>
        `Previous period of the same length: net ${net}, win rate ${winRate}, profit factor ${pf}`,
    },

    equity: {
      title: "Equity curve",
      hint: "running total of closed trades",
      account: "account",
      result: "trade",
      pace: "even pace",
    },
    risk: {
      title: "Result distribution (R)",
      titleTotals: "Totals by result (R)",
      hint: "share of trades by result size",
    },

    rBuckets: {
      "<-2R": "below -2R",
      "-2R..-1R": "-2R … -1R",
      "-1R..0": "-1R … 0",
      "0..1R": "0 … +1R",
      "1R..2R": "+1R … +2R",
      "2R..3R": "+2R … +3R",
      ">3R": "+3R and above",
    } as Record<string, string>,

    hold: {
      title: "Time in trade",
      hint: "how long trades were held",
    },
    holdBuckets: {
      "<5m": "< 5 min",
      "5-15m": "5-15",
      "15-30m": "15-30",
      "30-60m": "30-60",
      "1-2h": "1-2 h",
      "2-4h": "2-4 h",
      ">4h": "> 4 h",
    } as Record<string, string>,

    sidesTitle: {
      title: "Trade types",
      hint: "long against short",
      long: "Long",
      short: "Short",
    },

    symbols: {
      title: "Coins",
      titleProfit: "Profit by coin",
      hint: "click to keep just one",
    },
    week: {
      title: "Weekdays",
      hint: "share of trades by day",
      titleResult: "Weekdays",
      hintResult: "result by day of close",
    },
    hours: { title: "Hours", hint: "result by hour of entry" },

    timing: {
      title: "Result over time",
      hint: "when trading goes better",
      weekday: "Days",
      hour: "Hours",
      session: "Sessions",
    },

    sessions: {
      asia: "Asia",
      europe: "Europe",
      usa: "US",
      night: "Evening",
    } as Record<string, string>,

    stats: {
      title: "Detailed statistics",
      hint: "over the selected trades",
      trades: "Trades total",
      wins: "Winners",
      losses: "Losers",
      net: "Total result",
      expectancy: "Average result",
      best: "Max win",
      worst: "Max loss",
      prevNet: "Previous period",
      prevWinRate: "Previous win rate",
      rate: (pct: number) => `win rate ${pct}%`,
    },

    recent: {
      title: "Recent trades",
      hint: "history of closed trades",
      coin: "Coin",
      side: "Side",
      entry: "Entry",
      exit: "Exit",
      size: "Size",
      when: "Date",
    },

    table: {
      title: "Breakdown",
      hint: "click a coin to keep just one",
      cuts: {
        symbol: "Coin",
        side: "Sides",
        session: "Sessions",
        weekday: "Weekdays",
        hour: "Hours",
        outcome: "Trade types",
      },
      trades: "Trades",
      pnl: "P&L",
      avgR: "Average R",
      best: "Max win",
      worst: "Max loss",
      hold: "Time in trade",
      sessionsNote: (bounds: string) => `Hours are local, by your device clock: ${bounds}`,
    },

    outcomes: {
      title: "How they ended",
      hint: "and streaks in a row",
      take: "By target",
      stop: "By stop",
      manual: "By hand",
    },
    streaks: {
      title: "Streaks",
      titleFull: "Streaks and how trades ended",
      hint: "in a row and what they cost",
      best: "best streak",
      worst: "worst streak",
      current: "now",
    },
    extremes: {
      title: "Best and worst",
      best: "Best trades",
      worst: "Worst trades",
      hint: "where a review starts",
      hintWorst: "where a review starts",
    },
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
};
