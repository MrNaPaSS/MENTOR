export const pricing = {
  meta: {
    title: "Access to the NMNH terminal: free or by subscription",
    description:
      "The NMNH terminal is free: register an exchange account through the academy and everything is unlocked, down to part of your fee coming back. The 49 USDT subscription is only for traders who want to stay on their existing account.",
  },

  nav: {
    plans: "Plans",
    compare: "Comparison",
    faq: "FAQ",
    back: "Home",
  },

  hero: {
    eyebrow: "Terminal access",
    titleTop: "The fee goes to the exchange either way.",
    titleAccent: "The only question is whether part of it comes back to you.",
    lead:
      "Register an exchange account through the academy and the whole terminal opens up, free. The subscription is for one person only: the one who will not move accounts.",
    bullets: ["Your money stays on your exchange", "Keys without withdrawal rights"],
    shotAlt: "NMNH terminal: chart, order book and order panel in one window",
    cta: "Open an account and trade free",
    ctaSecondary: "Stay on your account - 49 USDT",
  },

  venues: {
    note: "Five exchanges to choose from - an account opens on any of them",
  },

  plans: {
    eyebrow: "Plans",
    title: "One terminal, two doors",
    subtitle: "The first is free and gives everything - it needs an exchange account registered through the academy. The second is paid and needs nothing but the payment.",
    perMonth: "USDT / month",
    perYear: "USDT / year",

    billing: {
      month: "Monthly",
      year: "Yearly",
      save: "cheaper",
    },
    free: {
      name: "Through the academy",
      price: "0",
      priceNote: "while you trade through us",
      hint: "Exchange account registered through the academy - everything else is unlocked",
      features: [
        "The entire terminal, nothing stripped out and no access tiers",
        "All five exchanges at once",
        "The trade records itself - with screenshots of entry, target and stop",
        "Cluster candles, volume candles and VISION markup",
        "100-row order book, price step ×25, market-wide screener",
        "Journal, metrics and analytics with no history limit",
        "Part of your fee comes back to your exchange account",
        "Academy, live chat, trade reviews and live sessions",
        "Coins for discipline, achievements and the trader certificate",
        "Tools unlock with coins earned by trading, no extra money",
      ],
      cta: "Open an exchange account",
    },
    base: {
      name: "Terminal",
      price: "49",
      priceYear: "500",
      priceNote: "new users: +7 days on the first payment",
      hint: "Any account on any of the five exchanges",
      badge: "For your own account",
      features: [
        "Size and risk calculated before entry",
        "Stop and targets go to the exchange with the trade",
        "Breakeven moved by the server, not the tab",
        "Journal and metrics from exchange reports",
        "One exchange of your choice, three months of history",
      ],
      cta: "Subscribe",
    },
    pro: {
      name: "Terminal Pro",
      price: "99",
      priceYear: "1100",
      priceNote: "new users: +7 days on the first payment",
      hint: "Everything in Terminal plus what saves hours",
      features: [
        "The trade records itself - with screenshots of entry, target and stop",
        "All five exchanges at once",
        "Cluster and volume candles, VISION markup",
        "100-row order book and price step ×25",
        "Full journal history and export",
        "Priority support",
      ],
      cta: "Subscribe",
    },
  },

  compare: {
    eyebrow: "Comparison",
    title: "What each door includes",
    subtitle: "The essentials line by line - including the tools that unlock with coins.",
    columns: { free: "Academy", base: "Terminal", pro: "Pro" },
    yes: "yes",
    no: "no",
    rows: [
      { group: "The trade" },
      { label: "Size and risk calculated before entry", free: true, base: true, pro: true },
      { label: "Entry, stop and targets sent to the exchange in one operation", free: true, base: true, pro: true },
      { label: "Levels dragged with the mouse, the entry carries its targets", free: true, base: true, pro: true },
      { label: "Breakeven moved by the server, not the tab", free: true, base: true, pro: true },

      { group: "Market and order book" },
      { label: "Order book with walls and clusters on one scale", free: true, base: true, pro: true },
      { label: "Market screener, funding and news", free: true, base: true, pro: true },
      { label: "Cluster and volume candles", free: true, base: false, pro: true },
      { label: "NMNH VISION markup", free: true, base: false, pro: true },
      { label: "Order book depth 60 and 100, price step ×25", free: true, base: false, pro: true },

      { group: "Journal and analytics" },
      { label: "Trades from exchange fills, fees on a separate line", free: true, base: true, pro: true },
      { label: "Equity curve, profit factor, average R, drawdown", free: true, base: true, pro: true },
      { label: "Breakdown by coin, side, weekday, hour and session", free: true, base: true, pro: true },
      { label: "Month calendar and the trader's path across milestones", free: true, base: true, pro: true },
      { label: "Journal and analytics history", free: "full", base: "3 months", pro: "full" },
      { label: "Entry, target and stop screenshots in the trade", free: true, base: false, pro: true },
      { label: "Journal export", free: true, base: false, pro: true },

      { group: "Rewards and community" },
      { label: "Coins for discipline, achievements and monthly goals", free: true, base: false, pro: false },
      { label: "Trader certificate across four pillars", free: true, base: false, pro: false },
      { label: "Live trader chat inside the terminal", free: true, base: false, pro: false },
      { label: "Academy, trade reviews and live sessions", free: true, base: false, pro: false },
      { label: "Cards for a trade, a day, a week and a month", free: true, base: true, pro: true },

      { group: "Account and money" },
      { label: "Exchanges connected at once", free: "5", base: "1", pro: "5" },
      { label: "Part of the fee back to your exchange account", free: "up to 45%", base: false, pro: false },
      { label: "Priority support", free: false, base: false, pro: true },
    ],
  },

  trial: {
    eyebrow: "First payment",
    title: "The first month is 37 days",
    text:
      "New users only: the first subscription payment comes with seven extra days as a gift. You pay for a month and use thirty-seven days, and after that a month is just a month.",
    points: [
      "The gift is granted once and only on the first subscription",
      "Connect an exchange with a key that cannot withdraw and trade",
      "Not a fit - cancel in one click and no next invoice arrives",
    ],
  },

  billing: {
    eyebrow: "Billing",
    title: "How it is paid",
    text:
      "Paid in USDT. The next invoice arrives in advance with a reminder in the bot: the terminal is never switched off silently on the last day.",
    points: [
      "Invoice and a bot reminder arrive three days before the period ends",
      "Three and six months are paid at a discount",
      "Cancel in one click, no calls and no emails",
      "An open position is seen through even after the period ends",
    ],
  },

  faq: {
    eyebrow: "FAQ",
    title: "Common questions",
    items: [
      {
        q: "What happens to an open trade when the subscription ends?",
        a: "It is seen through: the stop and targets already sit on the exchange and the server still moves the stop to breakeven. Only new entries are blocked until you pay.",
      },
      {
        q: "Can I switch from the subscription to the free path?",
        a: "Yes. Register a new exchange account through the academy, send the UID - and the subscription is no longer needed: the terminal is free and part of the fee comes back.",
      },
      {
        q: "Why can't I trade for free on my old account?",
        a: "The exchange sees no link between us and an account registered outside the academy: the volume is not credited and no partner payout arrives. Then the terminal is paid for by the subscription instead of the exchange.",
      },
      {
        q: "Which USDT network do you accept?",
        a: "The networks and the address are shown at checkout. The sender pays the network fee, and funds are credited after confirmations.",
      },
      {
        q: "Do you hold the money?",
        a: "No. The deposit stays in your exchange account, the key is created without withdrawal rights, and it can be unlinked in one click.",
      },
      {
        q: "Will the price change?",
        a: "Not for periods already paid. If the plan changes, an active subscription runs out at its own price.",
      },
    ],
  },

  cta: {
    title: "The simplest path is the free one",
    text:
      "Registering an exchange account through the academy takes a couple of minutes, money moves inside the exchange, and from there the terminal costs nothing. The subscription stays for those who find moving the account inconvenient - and the first payment comes with a gifted week on top.",
    primary: "Open an account and trade free",
    secondary: "I need the subscription",
  },
};
