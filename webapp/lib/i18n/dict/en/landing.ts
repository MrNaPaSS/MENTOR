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
    titleTop: "These aren't signals.",
    titleAccent: "This is a trading terminal.",
    lead: "A trader's ecosystem: a terminal with order book and chart, software wired to your exchange account, a live chat, a trade journal with activities and an in-platform token.",
    bullets: [
      "Free, no subscriptions",
      "Your money stays on your exchange",
      "API keys with withdrawals disabled",
    ],
    ctaTerminal: "Open the terminal",
    ctaWeex: "Open an exchange account",
  },

  terminal: {
    eyebrow: "The academy terminal",
    titleTop: "These aren't signals.",
    titleAccent: "This is your workstation.",
    subtitle:
      "A trade opens in one click: the risk is sized, stop and targets go to the exchange with your entry, and the server runs the position from there.",
    shotAlt: "NMNH terminal: chart, order book and order panel in one window",
    channelEyebrow: "Everywhere else",
    channelTitle: "A signal channel",
    channelLimits: [
      "A screenshot with levels - do the math yourself",
      "It landed at night - the entry is gone",
      "Nobody moves your stop for you",
      "No statistics",
    ],
    usEyebrow: "Here",
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
    note: (pending: number) => `${pending} pending connection`,
  },

  how: {
    eyebrow: "How it works",
    title: "From sign-up to your first trade",
    subtitle: "Four steps and the terminal trades on your exchange account. No payments, no applications.",
    steps: [
      { title: "Sign up on an exchange", text: "Open an account through the partner link and fund it - it takes a couple of minutes." },
      { title: "Send your UID to the bot", text: "The academy confirms your account - and the exchange shows up in your settings." },
      { title: "Connect the exchange", text: "Create an API key without withdrawal rights and paste it into the terminal - your account is live." },
      { title: "Trade from the terminal", text: "The size is already fitted to your deposit: hit “Enter” and the server runs the trade to the end." },
    ],
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
