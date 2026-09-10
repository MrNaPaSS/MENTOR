export const landing = {
  nav: {
    about: "About",
    terminal: "Terminal",
    how: "How it works",
    signals: "Signals",
    results: "Results",
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
    ctaWeex: "Open a WEEX account",
  },

  terminal: {
    eyebrow: "The academy terminal",
    titleTop: "These aren't signals.",
    titleAccent: "This is your workstation.",
    subtitle:
      "A signal opens in one click: the risk is sized, stop and targets are already on the exchange, and the server runs the position from there.",
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
      { title: "Your account, your exchange", text: "API connection in a minute. The money stays in your WEEX account." },
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
    ctaText: "Registering on WEEX through our link unlocks it. No subscriptions, no payments.",
    ctaPrimary: "Open the terminal",
    ctaSecondary: "WEEX account",
  },

  how: {
    eyebrow: "How it works",
    title: "From sign-up to your first trade",
    subtitle: "Four steps and the terminal trades on your exchange account. No payments, no applications.",
    steps: [
      { title: "Sign up on WEEX", text: "Open an account through the partner link and fund it - it takes a couple of minutes." },
      { title: "Log in through the bot", text: "The academy bot recognises you by your WEEX UID and issues a password for the platform." },
      { title: "Connect the exchange", text: "Create a WEEX API key without withdrawal rights and paste it into the terminal - your account is live." },
      { title: "Trade from the terminal", text: "The signal is already sized to your deposit: hit “Enter” and the server runs the trade to the end." },
    ],
  },

  stats: {
    eyebrow: "Platform statistics",
    title: "Numbers, not promises",
    subtitle: "Live platform data - nothing dressed up.",
    winrate: "Win rate",
    bestRR: "Best signal RR",
    maxMove: "Max. move",
    volume: "Trading volume ($)",
    avgProfit: "Avg profit/trade",
    yearsOnMarket: "Years on the market",
  },

  publicSignals: {
    eyebrow: "Mentor's analysis",
    title: "Market breakdowns - members only",
    subtitle: "Annotated charts with the mentor's reasoning. Full access after you log in.",
    unlock: "Log in to read it all →",
  },

  results: {
    eyebrow: "Student results",
    title: "Real PnL",
    subtitle: "Screenshots from the exchange. Published with the students' consent.",
    imageAlt: "PnL result",
  },

  faq: {
    eyebrow: "FAQ",
    title: "Frequent questions",
    subtitle: "Everything worth knowing before you start - straight, no filler.",
    items: [
      {
        tag: "Academy",
        q: "What is NMNH?",
        a: "NMNH (No Money No Honey) is a trading academy with its own terminal, community and analytics. It isn't a signal channel: the terminal connects to your exchange account and manages the open position itself.",
      },
      {
        tag: "Terminal",
        q: "How is this different from ordinary signals?",
        a: "A signal in a channel is a picture - the rest you do by hand. Here it opens in the terminal: size is fitted to your deposit, stop and targets go to the exchange along with the entry, and the server then moves the stop to breakeven for you.",
      },
      {
        tag: "Security",
        q: "Is it safe to hand over API keys?",
        a: "The key is created for trading only, with withdrawals disabled - no one can take money out with it. On the server keys are encrypted and never returned to the browser. You can unlink in one click.",
      },
      {
        tag: "Exchange",
        q: "Is it WEEX only?",
        a: "Yes. Limit sizing, fee calculation and trade management are all built around WEEX, and WEEX is also what opens access to the academy.",
      },
      {
        tag: "Price",
        q: "What does access cost?",
        a: "Nothing at all. Just register on WEEX through our partner link and access opens automatically.",
      },
      {
        tag: "Access",
        q: "How do I get in?",
        a: "Register on WEEX through the partner link, send your WEEX UID to the bot - and you're in. No payments, no applications, no waiting.",
      },
      {
        tag: "What's inside",
        q: "What does the academy include?",
        a: "Trading signals sized to your deposit, our own market-analysis software, a live community of traders, trade reviews and constant development.",
      },
      {
        tag: "Getting started",
        q: "Do I need trading experience?",
        a: "No. The academy suits beginners and experienced traders alike. Every signal already carries all the parameters - all that's left is to open the trade.",
      },
      {
        tag: "Mobile",
        q: "Is there a mobile app?",
        a: "Yes - the WebApp runs right inside Telegram and is fully adapted for phones. Open trades, read signals and analytics in one tap.",
      },
    ],
    ctaTitle: "Still have a question?",
    ctaText: "Write to us on Telegram - we answer within a few hours.",
    ctaButton: "Message us on Telegram →",
  },

  socials: {
    eyebrow: "Social",
    title: "Keep up with the trades",
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
    emailHeading: "Partnerships",
    emailHint: "Exchanges, venues and affiliate programmes",
    rights: "© 2020 NMNH. All rights reserved.",
    disclaimer:
      "Crypto trading carries high risk, especially with high leverage (up to x400 in turbo mode). You can lose your entire deposit. This is not financial advice.",
  },
};
