export const pricing = {
  meta: {
    title: "NMNH terminal subscription: 49 USDT per month",
    description:
      "Your own account on any of five exchanges plus the NMNH workplace on a subscription: risk sized before entry, stop and targets on the exchange, the server running the position and a journal built from exchange reports. Paid in USDT, seven days free.",
  },

  nav: {
    plans: "Plans",
    compare: "Comparison",
    faq: "FAQ",
    back: "Home",
  },

  hero: {
    eyebrow: "Terminal subscription",
    titleTop: "Your exchange account -",
    titleAccent: "and our workplace.",
    lead:
      "If your account was opened outside our link, there is no need to open a second one. The subscription gives you the same terminal: size calculated before entry, stop and targets sent to the exchange with the trade, and the server running the position from there.",
    bullets: ["Paid in USDT", "Seven days free", "Cancel any time"],
    cta: "Try seven days",
    ctaSecondary: "Or free through the academy",
  },

  plans: {
    eyebrow: "Plans",
    title: "Two ways to the same terminal",
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
      priceNote: "first seven days free",
      hint: "Any account on any of the five exchanges",
      badge: "For your own account",
      features: [
        "Size and risk calculated before entry",
        "Stop and targets go to the exchange with the trade",
        "Breakeven moved by the server, not the tab",
        "Journal and metrics from exchange reports",
        "One exchange of your choice, three months of history",
      ],
      cta: "Try seven days",
    },
    pro: {
      name: "Terminal Pro",
      price: "99",
      priceNote: "first seven days free",
      hint: "Everything in Terminal plus what saves hours",
      features: [
        "The trade records itself - with screenshots of entry, target and stop",
        "All five exchanges at once",
        "Cluster and volume candles, VISION markup",
        "100-row order book and price step ×25",
        "Full journal history and export",
        "Priority support",
      ],
      cta: "Try seven days",
    },
  },

  compare: {
    eyebrow: "Comparison",
    title: "What each path includes",
    columns: { free: "Academy", base: "Terminal", pro: "Pro" },
    yes: "yes",
    no: "no",
    rows: [
      { label: "Risk sized before entry", free: true, base: true, pro: true },
      { label: "Stop and targets on the exchange with the entry", free: true, base: true, pro: true },
      { label: "Position managed by the server", free: true, base: true, pro: true },
      { label: "Journal built from exchange fills", free: true, base: true, pro: true },
      { label: "Fee cashback", free: "up to 15%", base: false, pro: false },
      { label: "Exchanges connected at once", free: "5", base: "1", pro: "5" },
      { label: "Cluster, volume candles and VISION", free: true, base: false, pro: true },
      { label: "100-row book and step ×25", free: true, base: false, pro: true },
      { label: "Entry, target and stop screenshots in the journal", free: true, base: false, pro: true },
      { label: "Journal and analytics history", free: "full", base: "3 months", pro: "full" },
      { label: "Journal export", free: true, base: false, pro: true },
      { label: "Academy, chat and reviews", free: true, base: false, pro: false },
    ],
  },

  trial: {
    eyebrow: "Trial",
    title: "Seven days free",
    text:
      "Nothing is charged for a week. In that time you do exactly what the terminal is for: connect an account and take your first ten trades. If it does not fit - cancel in one click and no invoice is issued.",
    points: [
      "Connect an exchange with a key that cannot withdraw",
      "Take your first trades and look at the journal",
      "A reminder about the charge arrives three days ahead",
    ],
  },

  billing: {
    eyebrow: "Billing",
    title: "How it is paid",
    text:
      "Paid in USDT. Crypto has no automatic charges, so the next invoice is issued in advance instead of silently switching the terminal off on the last day.",
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
    title: "Seven days to check it on your own trades",
    text: "No account through our link and no commitment: if it does not fit, cancel in one click.",
    primary: "Try seven days",
    secondary: "Look at the terminal first",
  },
};
