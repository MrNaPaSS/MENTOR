export const shop = {
  title: "Store",
  hint: "What to spend your NMNH coins on",

  cats: {
    all: "All",
    tools: "Tools",
    features: "Features",
    frames: "Style",
    merch: "Merch",
    software: "Our software",
  },
  empty: "Nothing here yet.",

  /** Search and order of the cards. */
  search: "Search items…",
  sort: {
    label: "Order",
    catalog: "Catalog order",
    cheap: "Cheapest first",
    expensive: "Most expensive first",
  },
  nothingFound: "Nothing found.",

  /** Right column: community, our software and the brand line. */
  community: {
    lines: ["More", "than trading -", "a community"],
    join: "Join",
  },
  soft: {
    title: "Our software",
    more: "Details",
    links: {
      features: "Exclusive features",
      frames: "Profile styling",
      merch: "Merch and accessories",
      software: "Useful tools",
    },
  },

  balance: "Balance",
  waiting: (n: number) => `Waiting to be claimed: ${n}`,
  claim: "Claim",
  goal: (title: string, n: string) => `${n} left to "${title}"`,
  earnToggle: "How to earn",
  earnLines: [
    "Winning trade: +10",
    "Streak of 3, 5 and 10 wins: +15, +30, +100",
    "Loss: −5",
    "Achievements, levels and academy lessons",
    "Trades pay no more than 150 a day",
  ],

  activity: {
    access: "Access",
    history: "History",
    orders: "Orders",
  },
  showAll: (n: number) => `All · ${n}`,
  historyEmpty: "No coins yet.",
  accessEmpty: "Purchased features and frames will show up here.",
  ordersEmpty: "No orders yet.",
  forever: "forever",
  until: (date: string) => `until ${date}`,
  chargesLeft: (n: number) => `charges: ${n}`,

  terms: {
    forever: "Forever",
    days: (n: number) => `For ${n} days`,
    charges: (n: number) => `Charges: ${n}`,
    instant: "Switched on at once",
    manual: "Granted by the mentor",
    delivery: "Delivery",
    free: "Free",
  },

  pick: {
    colorLabel: "Colour",
    sizeLabel: "Size",
    color: (value: string) => `Colour: ${value}`,
    size: (value: string) => `Size: ${value}`,
    addressLabel: "Telegram and delivery address",
    addressPlaceholder: "@username, city, street, building, flat, postcode",
  },

  buy: "Buy",
  extend: "Extend",
  buyMore: "Buy more",
  bought: "Owned",
  notEnough: (n: string) => `${n} short`,
  saved: (n: string) => `${n}% saved`,
  details: "Details",
  openLink: "Open",
  soon: "Soon",

  equip: "Wear",
  equipped: "Wearing",
  unequip: "Take off",
  yourPreview: "How it looks on you",
  rankOnly: (n: number) => `Given for place ${n} on the leaderboard. Not for sale.`,
  rankLock: (n: number) => `Top ${n}`,

  status: {
    pending: "Awaiting delivery",
    fulfilled: "Delivered",
    rejected: "Rejected (refunded)",
  },

  confirmTitle: "Purchase",
  confirmFor: "for",
  confirmInstant: "Access switches on right after the purchase.",
  confirmNote: "Coins are deducted immediately, the mentor grants access manually.",
  confirmMerch: "Coins are deducted immediately. The mentor will contact you and ship the order.",
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
    journal_export: "Journal export: report",
    tool_vision: "NMNH VISION",
    tool_footprint: "Cluster candle",
    tool_volume_candles: "Volume candles",
    tool_dom_depth: "Order book 60 and 100 rows",
    tool_dom_step25: "Order book step ×25",
    frame_neon: "Neon frame",
    frame_carbon: "Carbon frame",
    frame_pulse: "Pulse frame",
    frame_candles: "Candles frame",
    frame_crown: "Crown frame",
  } as Record<string, string>,

  rankFrames: {
    gold: "Gold frame",
    silver: "Silver frame",
    bronze: "Bronze frame",
  } as Record<string, string>,
};
