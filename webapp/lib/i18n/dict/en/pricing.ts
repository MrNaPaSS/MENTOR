export const pricing = {
  meta: {
    title: "Access to the NMNH terminal: free or by subscription",
    description:
      "The NMNH terminal is free: open an account through the academy link and everything is unlocked, down to part of your fee coming back. The 49 USDT subscription is only for traders who want to stay on their existing account.",
  },

  nav: {
    plans: "Plans",
    compare: "Comparison",
    faq: "FAQ",
    back: "Home",
  },

  hero: {
    eyebrow: "Terminal access",
    titleTop: "We charge nothing for the terminal.",
    titleAccent: "Except in one case.",
    lead:
      "Open an account through the academy link and everything is unlocked: the whole terminal, all five exchanges, journal and analytics, academy and chat - and part of your fee comes back on top. The subscription exists for exactly one person: the one who does not want to move trading to a new account.",
    bullets: ["No subscriptions or tiers by default", "Your money stays on your exchange", "Keys without withdrawal rights"],
    shotAlt: "NMNH terminal: chart, order book and order panel in one window",
    cta: "Open an account and trade free",
    ctaSecondary: "Stay on your account - 49 USDT",
  },

  plans: {
    eyebrow: "Plans",
    title: "One terminal, two doors",
    subtitle: "The first is free and gives everything - it only needs an account opened through our link. The second is paid and needs nothing but the payment.",
    perMonth: "USDT / month",
    free: {
      name: "Through the academy",
      price: "0",
      priceNote: "while you trade through us",
      hint: "Open the account through our link - everything else is unlocked",
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
      priceNote: "+7 days as a gift on the first payment",
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
      priceNote: "+7 days as a gift on the first payment",
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
    title: "The first month is a week longer",
    text:
      "There is no trial period: the terminal is yours for a month right away, and we add another seven days to the first payment. Thirty-seven days from the first charge - enough to connect an account, take your first trades and see the journal count everything for you.",
    points: [
      "Connect an exchange with a key that cannot withdraw",
      "Take your first trades, look at the journal and metrics",
      "The gifted week is added automatically, no need to ask",
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
        a: "Yes. Open an account through the academy link, send the UID - and the subscription is no longer needed: the terminal is free and part of the fee comes back.",
      },
      {
        q: "Why can't I trade for free on my old account?",
        a: "The exchange sees no link between us and an account opened elsewhere: the volume is not credited and no partner payout arrives. Then the terminal is paid for by the subscription instead of the exchange.",
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
      "An account through the academy link takes a couple of minutes, money moves inside the exchange, and from there the terminal costs nothing. The subscription stays for those who find moving the account inconvenient - and the first payment comes with a gifted week on top.",
    primary: "Open an account and trade free",
    secondary: "I need the subscription",
  },
};
