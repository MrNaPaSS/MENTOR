import { cashbackList } from "@/lib/venues";

export const landing = {
  nav: {
    about: "About",
    terminal: "Terminal",
    how: "How it works",
    faq: "FAQ",
  },

  hero: {
    eyebrow: "The trading terminal of the NMNH academy",
    titleTop: "Your trade lives on the exchange,",
    titleAccent: "not in a browser tab.",
    lead: "Size is calculated against your deposit before entry, stop and targets go to the exchange together with the trade, and from there the server runs the position - even with the browser closed.",
    bullets: [
      "Free, no subscriptions",
      "Your money stays on your exchange",
      "API keys with withdrawals disabled",
    ],
    oneClick:
      "A trade opens in one click: the risk is calculated, stop and targets go to the exchange together with the entry, and from there the server runs the position.",
    shotAlt: "NMNH terminal: chart, order book and order panel in one window",
    ctaTerminal: "Enter via the academy",
    ctaWeex: "Open an exchange account",
  },

  terminal: {
    eyebrow: "The academy terminal",
    titleTop: "One window",
    titleAccent: "instead of five tabs.",
    subtitle:
      "Order book, clusters, screener and journal sit next to the chart: no more hunting for an entry in one tab and sizing the risk in another.",
    usTitle: "The NMNH terminal",
    usBadge: "Free",
    usGains: [
      "Size and risk - fitted to your deposit",
      "Order sent to the exchange in one click",
      "The server runs the position while you sleep",
      "The journal counts from exchange fills",
    ],
    features: [
      {
        title: "Five exchanges",
        text: "Trading on WEEX, OKX, BingX, MEXC and Binance. The money stays in your account.",
      },
      { title: "Order book and tape", text: "Liquidity walls, clusters and a market-wide screener - live." },
      { title: "Drag your levels", text: "Drag the stop on the chart and the exchange order follows it." },
      { title: "Risk sized for you", text: "Lot step, leverage cap and the symbol's fees are accounted for before entry." },
      { title: "24/7 position management", text: "A target is hit - the stop moves to breakeven. The server does it, not your browser tab." },
      { title: "Trade journal", text: "Result, fees and targets - taken from exchange fills." },
    ],
    safety: [
      { title: "Keys are encrypted", text: "They live on the server and are never sent back to the browser." },
      { title: "No withdrawal rights", text: "The key is trade-only - nobody can move money out with it." },
      { title: "Unlink in one click", text: "Or revoke the key on the exchange side - any time." },
    ],
    ctaTitle: "Terminal access is free",
    ctaText: "Registering on an exchange through our link unlocks it. No subscriptions, no payments.",
    ctaPrimary: "Open the terminal",
    ctaSecondary: "Exchange account",
  },

  signup: {
    button: "Open an exchange account",
    title: "Where to open an account",
    subtitle: "The terminal works on all five. What differs is the cashback terms.",
    cashback: (pct: string) => `${pct} of the fee comes back`,
    noCashback: "No cashback",
    cashbackSoon: "Cashback terms are being agreed",
    open: "Open account",
    close: "Close",
    note:
      "The account is opened on the exchange itself and stays yours. Use the link from here: an account opened elsewhere is invisible to the academy, and none of the terms apply to it.",
  },

  why: {
    eyebrow: "Why us",
    title: "Four parts of one system",
    subtitle: "Sold separately elsewhere, and not cheaply. Here they work together.",
    items: [
      {
        title: "The terminal",
        text: "Order book, footprint and risk sized before entry. Stop and targets go to the exchange with the trade, and the server runs it from there - while you sleep.",
      },
      {
        title: "Five exchanges",
        text: "WEEX, OKX, BingX, MEXC and Binance in one interface. The account stays yours, the key has no withdrawal rights.",
      },
      {
        title: "Fee cashback",
        text: "Up to 45% of your own fee comes back to your exchange account. No subscriptions, no plans: the terminal is free.",
      },
      {
        title: "Academy and community",
        text: "Training from the basics upwards, live trading sessions and trade reviews - in the same place you trade.",
      },
    ],
    note: "None of it is sold separately or locked behind access tiers.",
  },

  exchanges: {
    eyebrow: "Partners",
    title: "Our partners",
    subtitle: "We work with more than 8 official exchanges. On five of them the terminal already trades.",
    live: "trading is live",
    signup: "open an account →",
    cashback: (pct: string) => `${pct} of the fee back`,
    noCashback: "no cashback",
    cashbackSoon: "cashback terms being agreed",
  },

  problem: {
    eyebrow: "Why accounts blow up",
    title: "Three reasons winning setups end up losing",
    subtitle: "None of them is about the entry. All three are about what happens after it.",
    items: [
      {
        title: "Size calculated in your head",
        text:
          "The stop comes from the chart, the size comes from “about the same as last time”. On a tight stop you risk half of what you should, on a wide one you risk double. Winners end up small, losers end up big - and the win rate still looks great.",
      },
      {
        title: "Fees you never see",
        text:
          "Over a month they add up to a number comparable to your result. Until you pull them out into a separate line, they stay smeared across a hundred trades.",
      },
      {
        title: "Two evenings out of thirty",
        text:
          "The journal shows it: on two days you took three times your usual number of trades, and both followed a losing streak. Those two days eat the month.",
      },
    ],
    note: "The terminal does not guess the price. It closes exactly these three holes.",
  },

  flow: {
    eyebrow: "Scalping and day trading",
    title: "What happens in one click",
    subtitle:
      "What takes four windows and mental arithmetic on an exchange interface is calculated for you here. And what cannot be done fast, the server does.",
    steps: [
      {
        title: "See",
        items: [
          "Order book and clusters on one price scale: intent and fact read on a single line",
          "Liquidity walls named outright: size, price, support or resistance",
          "The book does not jitter - numbers change, row order does not",
          "Depth of 60 and 100 rows, price step ×25 for small coins",
          "Market screener, funding, trending coins and news in the same window",
        ],
      },
      {
        title: "Enter",
        items: [
          "A click on a wall opens the calculation, the side follows from the book",
          "Lot step, leverage cap and the coin's fee are accounted for before entry",
          "Change the leverage and see what happened to the risk immediately",
          "Entry, stop and targets go to the exchange in one operation",
          "The target ladder is placed at once, not added by hand later",
        ],
      },
      {
        title: "Manage",
        items: [
          "Drag the stop on the chart and the order on the exchange moves with it",
          "Move the entry and the whole target ladder follows",
          "A target is hit - the stop goes to breakeven, and the server does it",
          "The order window is draggable and never covers the level you need",
          "Prices can be typed where the mouse cannot catch them",
        ],
      },
      {
        title: "Count",
        items: [
          "A dozen fills are merged into one trade automatically",
          "Fees are shown as a separate line",
          "You see which hour and which weekday eats your month",
          "Profit factor and average trade, not just the bottom line",
          "Trade cards on your own template, with no one else's referral code",
        ],
      },
    ],
    note:
      "Neither the terminal nor the risk calculation makes trading risk-free. They remove execution mistakes - the ones that come from haste and mental arithmetic. The rest is still on the trader.",
  },

  proof: {
    eyebrow: "What it looks like",
    title: "One trade from entry to journal entry",
    subtitle: "An ETH short on WEEX. Three terminal screens: how it was entered, how it was managed, how it ended.",
    steps: [
      {
        title: "A wall at resistance",
        src: "/showcase/case/01-entry-v2.webp",
        alt: "NMNH terminal: a liquidity wall at resistance and a short order placed from it",
      },
      {
        title: "Target hit, stop at breakeven",
        src: "/showcase/case/02-run-v2.webp",
        alt: "NMNH terminal: stop moved to breakeven after the first target",
      },
      {
        title: "Exit and the journal entry",
        src: "/showcase/case/03-exit-v2.webp",
        alt: "NMNH terminal: closed trade and its result in the journal",
      },
    ],
    cards: {
      ours: "Terminal card",
      theirs: "The same trade on the exchange",
      oursSrc: "/showcase/case/04-card-nmnh.jpg",
      theirsSrc: "/showcase/case/05-card-weex.jpg",
      oursAlt: "ETHUSDT trade card from the NMNH terminal",
      theirsAlt: "The same ETHUSDT trade as a WEEX exchange card",
      note:
        "You can show your trade as a card instead of an exchange screenshot: the terminal builds it for you, from the same report.",
    },
  },

  stack: {
    eyebrow: "The ecosystem",
    title: "Separately, people charge a subscription for this",
    subtitle: "Here it is one workplace, and it costs nothing.",
    items: [
      {
        title: "Market data",
        objection: "“I'll have to keep three services open at once”",
        text:
          "Order book with liquidity walls, cluster and volume candles, NMNH VISION markup, a market-wide screener, funding, trending coins and news - in one window.",
      },
      {
        title: "Journal and metrics",
        objection: "“A spreadsheet lies: it gets filled in at night, when you remember the trade the way you'd like to”",
        text:
          "Trades are assembled from exchange fills. Equity curve, profit factor, average R, drawdown and fees on a separate line. A breakdown by coin, side, weekday, hour and trading session - and most of all, how the trade ended: at target, at stop or closed by hand.",
      },
      {
        title: "Calendar and trader's path",
        objection: "“The month is over and I can't recall what was in it”",
        text:
          "Every day of the month as a tile with its result and volume; tap one and you see every trade of that day. Next to it, the trader's path across volume milestones: you see how far the next one is.",
      },
      {
        title: "Coins and achievements",
        objection: "“Motivation lasts about a week”",
        text:
          "A winning trade earns coins, a losing one takes them away, a streak of clean trades pays a bonus on top. On top of that: monthly goals, achievements and your level. Coins are spent on terminal tools. These are internal points: not a cryptocurrency, not tradable, not withdrawable.",
      },
      {
        title: "Community and academy",
        objection: "“There's no one to ask, and nobody around in the moment of doubt”",
        text:
          "The trading floor and trade reviews live in the same window as your position: no switching to a messenger while a decision is being made. Alongside it, training from the basics upwards and live trading sessions.",
      },
      {
        title: "Cards and reports",
        objection: "“Nothing to show but a screenshot with someone else's logo”",
        text:
          "The terminal turns a closed trade into a card itself, from the exchange report. Certificates, charts and journal reports come out on the same template.",
      },
    ],
  },

  analytics: {
    eyebrow: "Analytics and progress",
    title: "The whole month at a glance",
    subtitle:
      "A calendar of trading days, monthly totals and a breakdown of every trade - inside your account, from exchange data. Not a separate service, not a spreadsheet export.",
    points: [
      "Every day of the month as a tile: result, volume and trade count. Tap it to see every trade of that day",
      "The month in numbers: days in profit, best and worst day, turnover",
      "The trader's path across volume milestones - you see how far the next one is",
      "Monthly goals, activity streaks and achievements are counted for you",
    ],
    shotAlt: "NMNH account: calendar of trading days, monthly totals and the trader's path",
    advTitle: "Metrics, not just the bottom line",
    advText:
      "Equity curve, trades distributed by R, weekdays, hours and trading sessions, coins, time in trade and streaks. You see not how much you made, but how exactly.",
    advAlt: "NMNH advanced analytics: equity curve, R distribution, weekdays, hours and streaks",
    detText:
      "Deeper: profit factor and average R, drawdown, best and worst trades, longs against shorts, and how each trade ended - at target, at stop or closed by hand.",
    detAlt: "NMNH detailed analytics: trade statistics, quality, trade types and breakdown by attribute",
    dayTitle: "Tap a day and there it is",
    dayText: "Every trade of that day: time, coin, side, entry, exit and the result of each.",
    dayAlt: "Trading day breakdown in the NMNH account: trades with entry, exit and result",
    cardTitle: "The day as a card",
    cardText: "A day, a week or a month folds into a card - save it or send it without assembling screenshots by hand.",
    cardAlt: "A trading day summary card built by the NMNH terminal",
  },

  showcase: {
    eyebrow: "The product",
    title: "Built so that you want to use it",
    subtitle: "Six things you notice on day one.",
    items: [
      { value: "15 minutes", label: "From sign-up to your first trade. With a curator if you'd rather not do it alone" },
      { value: "1 click", label: "Entry, stop and targets go to the exchange in a single operation" },
      { value: "24/7", label: "The server runs the position: breakeven moves even with the tab closed" },
      { value: "5 exchanges", label: "One workplace. The account stays yours, the money stays on the exchange" },
      { value: "From reports", label: "Journal, metrics and cards are counted from the exchange, not from our word" },
      { value: "No withdrawals", label: "The key is trade-only. Unlink it in one click" },
    ],
  },

  cert: {
    eyebrow: "Trader certificate",
    title: "Issued by your trades, not by a course",
    subtitle:
      "Four goals. Two of them closed is bronze, three is silver, four is gold. The certificate carries your name and number.",
    pillars: [
      { title: "Knowledge", text: "Academy course completed" },
      { title: "Practice", text: "50 trades through the terminal, confirmed by the exchange" },
      { title: "Discipline", text: "20 trading days, with a stop on every trade" },
      { title: "Growth", text: "A calendar month in profit, at least 10 trades" },
    ],
    note: "No goal can be closed with words: everything is counted from exchange reports.",
    alt: "NMNH trader certificate template: knowledge, practice, discipline, growth",
  },

  free: {
    eyebrow: "Price",
    title: "You are paying for this already",
    text:
      "A fee leaves your account on every trade, and it will keep leaving wherever you trade. The only question is whether part of it comes back. Through us it does - and the workplace comes on top.",
    points: [
      "No subscriptions, no tiers, no access levels",
      "Part of the fee comes back to your exchange account",
      "Your money stays on the exchange, the key has no withdrawal rights",
    ],
    kicker: "The terminal is not for sale. It comes with the account and stays yours while you trade.",
    cta: "What would come back from my volume",
  },

  how: {
    eyebrow: "Getting started",
    title: "Up and running in 15 minutes",
    subtitle:
      "Four steps and the terminal trades on your exchange account. Don't want to work it out alone - we'll walk them with you over a screen share.",
    steps: [
      { title: "Sign up on an exchange", text: "Open an account through the partner link and fund it - it takes a couple of minutes." },
      { title: "Send your UID to the bot", text: "The academy confirms your account - and the exchange shows up in your settings." },
      { title: "Connect the exchange", text: "Create an API key without withdrawal rights and paste it into the terminal - your account is live." },
      { title: "Trade from the terminal", text: "The size is already fitted to your deposit: hit “Enter” and the server runs the trade to the end." },
    ],
    guarantee: {
      title: "We'll connect it with you",
      text:
        "A call, a screen share - and in fifteen minutes we go through all of it: sign-up, UID, API key and the first trade. You don't need to know anything beforehand.",
      cta: "Connect with a curator",
    },
    haveAccount: {
      title: "Already have an account?",
      text:
        "You need one opened through our link - the terms only work on that account. Opening a second one takes a couple of minutes, and money moves inside the exchange. Don't want a new one - message the bot and we'll see what can be done with yours.",
      cta: "Message the bot",
    },
  },

  faq: {
    eyebrow: "FAQ",
    title: "Frequent questions",
    subtitle: "Everything worth knowing before you start - straight, no filler.",
    items: [
      {
        tag: "Academy",
        q: "What is NMNH?",
        a: "NMNH (No Money No Honey) is a trader's ecosystem: a professional terminal wired to your exchange account, training, a community and a trade journal. We do not sell signals - we give you the instrument people trade with.",
      },
      {
        tag: "Terminal",
        q: "How is this different from signal channels?",
        a: "A channel hands you a picture with levels and leaves the rest to you. We hand you a workstation: size is fitted to your deposit, stop and targets go to the exchange along with the entry, and the server then moves the stop to breakeven. What to trade is your call.",
      },
      {
        tag: "Security",
        q: "Is it safe to hand over API keys?",
        a: "The key is created for trading only, with withdrawals disabled - no one can take money out with it. On the server keys are encrypted and never returned to the browser. You can unlink in one click.",
      },
      {
        tag: "Exchange",
        q: "Which exchanges does the terminal support?",
        a: "We work with more than 8 official exchanges. Trading is already live on five - WEEX, OKX, BingX, MEXC and Binance; the rest are pending.",
      },
      {
        tag: "Price",
        q: "What does access cost?",
        a: "Nothing. Just register on an exchange through our partner link - the platform is paid for by the exchange fee, not by the trader.",
      },
      {
        tag: "Price",
        q: "How much of the fee comes back, and where does it land?",
        a: `${cashbackList()} of your own fee. It lands on your account at the exchange itself, not on a terminal balance, and is counted from the exchange's own reports. One condition: the account was opened through the academy link and the trades are made in the terminal. Binance has no cashback.`,
      },
      {
        tag: "Access",
        q: "How do I get in?",
        a: "Register on an exchange through the partner link and send your account UID to the academy bot. Once confirmed, the exchange opens in your settings - connect a key and trade.",
      },
      {
        tag: "What's inside",
        q: "What does the academy include?",
        a: "A terminal with order book, footprint and risk sizing, our own market-analysis software, a live community of traders, trade reviews and constant development.",
      },
      {
        tag: "Getting started",
        q: "Do I need trading experience?",
        a: "No. The terminal works out size, lot step and leverage for you, and the training starts from the basics. It removes routine for the experienced and keeps beginners from mis-sizing a position.",
      },
      {
        tag: "Mobile",
        q: "Is there a mobile app?",
        a: "Yes - the WebApp runs right inside Telegram and is fully adapted for phones. Open trades, read the order book and analytics in one tap.",
      },
    ],
    ctaTitle: "Still have a question?",
    ctaText: "Write to us on Telegram - we answer within a few hours.",
    ctaButton: "Message us on Telegram →",
  },

  socials: {
    eyebrow: "Social",
    title: "Stay in the loop",
    channel: "CHANNEL",
    academy: "ACADEMY",
  },

  footer: {
    about:
      "The No Money No Honey trader ecosystem: a free terminal wired to your own exchange account, exchange fee rebates, a journal built from exchange reports and a private community.",
    navHeading: "Navigation",
    pagesHeading: "Sections",
    pages: {
      broker: "Fee rebates",
      terminal: "Trading terminal",
      scalping: "Crypto scalping",
      community: "Trading community",
      journal: "Trade journal",
      pricing: "Access and subscription",
    },
    calculator: "Calculator",
    partnerHeading: "Partner",
    weexButton: "WEEX exchange →",
    /** Sign-up button: the exchange name comes from the link registry. */
    exchangeButton: (name: string) => `${name} exchange →`,
    emailHeading: "Partnerships",
    emailHint: "Exchanges, venues and affiliate programmes",
    rights: "© 2024 NMNH. All rights reserved.",
    disclaimer:
      "Crypto trading carries high risk, especially with high leverage (up to x400 in turbo mode). You can lose your entire deposit. This is not financial advice.",
  },
};
