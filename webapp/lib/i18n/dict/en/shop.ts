export const shop = {
  title: "Store",
  hint: "What to spend your NMNH coins on",

  tabs: {
    features: "Features",
    people: "Mentoring",
    software: "Our software",
  },
  tabHints: {
    features: "Switched on right after purchase",
    people: "Granted by the mentor by hand",
    software: "Our products and indicator access",
  },
  empty: "Nothing here yet.",

  balance: "Balance",
  waiting: (n: number) => `Waiting to be claimed: ${n}`,
  claim: "Claim",
  earnTitle: "How to earn",
  earnLines: [
    "Winning trade: +10",
    "Streak of 3, 5 and 10 wins: +15, +30, +100",
    "Loss: −5",
    "Achievements, levels and academy lessons",
    "Trades pay no more than 150 a day",
  ],
  historyTitle: "Coin history",
  historyEmpty: "No coins yet.",

  accessTitle: "My access",
  accessEmpty: "Purchased features will show up here.",
  forever: "forever",
  until: (date: string) => `until ${date}`,
  chargesLeft: (n: number) => `charges: ${n}`,

  terms: {
    forever: "Forever",
    days: (n: number) => `For ${n} days`,
    charges: (n: number) => `Charges: ${n}`,
    instant: "Switched on at once",
    manual: "Granted by the mentor",
  },

  buy: "Buy",
  extend: "Extend",
  buyMore: "Buy more",
  bought: "Owned",
  notEnough: (n: string) => `${n} short`,
  details: "Details",
  openLink: "Open",
  soon: "Soon",

  indicatorsTitle: "TradingView indicators",
  indicatorsHint: "The mentor grants access to your TradingView username",

  ordersSection: "My orders",
  status: {
    pending: "Awaiting delivery",
    fulfilled: "Delivered",
    rejected: "Rejected (refunded)",
  },

  confirmTitle: "Purchase",
  confirmFor: "for",
  confirmInstant: "Access switches on right after the purchase.",
  confirmNote: "Coins are deducted immediately, the mentor grants access manually.",
  after: (n: string) => `${n} NMNH will be left after the purchase`,
  tvLabel: "Your TradingView username (required to grant access)",
  contactLabel: "Contact for follow-up (Telegram / email)",
  tvPlaceholder: "Your TradingView username",
  tvHint: "Indicator access is granted to this TradingView account.",
  buying: "Buying…",
  buyError: "Purchase failed",
  done: (title: string) => `Done: "${title}" is on.`,
  doneManual: (title: string) => `Order "${title}" received, the mentor will grant access.`,

  features: {
    streak_freeze: "Streak freeze",
    streak_boost: "Double streak bonus",
    journal_export: "Journal export to CSV",
  } as Record<string, string>,
};
