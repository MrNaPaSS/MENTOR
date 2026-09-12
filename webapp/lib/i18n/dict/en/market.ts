export const market = {
  title: "Market",
  tabs: {
    pulse: { label: "Pulse", hint: "Market sentiment and the money behind positions" },
    screener: { label: "Screener", hint: "Where to work today" },
    news: { label: "Crypto news", hint: "Latest headlines from crypto outlets" },
    smart: { label: "Smart Money", hint: "What the big players are doing" },
    maps: { label: "Maps", hint: "The whole market in one picture" },
    calendar: { label: "Calendar", hint: "Events that move the market" },
  },
  tvNote: "Data and drawing - TradingView",
  // A quiet footnote in the panel corner: where the number came from and how
  // fresh it is. Shown only when there is something to say.
  origin: {
    stale: "not fresh",
    staleFrom: (source: string) => `${source}, not fresh`,
    from: (source: string) => `${source} data`,
    mixed: "several sources",
    title: "Where this data comes from",
  },
  news: {
    title: "Crypto news",
    loadFailed: "Couldn't load the news",
  },
  widgets: {
    heatmap: { title: "Market heat map", hint: "Size - 24h turnover, colour - price change" },
    forex: { title: "Currency pairs", hint: "Cross rates of the eight major currencies" },
    etf: { title: "Bitcoin ETFs", hint: "How much bitcoin the funds hold and how their shares move" },
    calendar: { title: "Event calendar", hint: "What moves the market this week: rates, inflation, employment" },
  },

  calendar: {
    emptyNote: "The calendar source did not answer",
    today: "today",
    previousTitle: "Previous value",
    day: (key: string) => {
      const [y, m, d] = key.split("-").map(Number);
      const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
      return new Intl.DateTimeFormat("en-GB", {
        weekday: "short", day: "numeric", month: "long", timeZone: "UTC",
      }).format(date);
    },
  },

  etf: {
    totalLabel: "Held by the funds",
    share: (pct: number) => `${pct.toFixed(1)}% of the market`,
  },

  pane: {
    emptyNote: "The source didn't answer",
    liveTitle: "The data updates itself",
    snapshotTitle: "A snapshot from when you opened it",
    snapshot: "Snapshot",
  },

  global: {
    title: "The whole market",
    live1m: "1 min",
    noData: "No data",
    marketCap: { label: "Market cap", hint: "The value of every coin together" },
    volume24h: { label: "Volume 24h", hint: "How much was traded in a day" },
    change24h: { label: "Change 24h", hint: "How much the market cap rose or fell in a day" },
    btcDominance: { label: "BTC dominance", hint: "Bitcoin's share of the market cap" },
    coins: { label: "Coins in circulation", hint: "How many coins the source counts" },
    failed: "The source didn't answer",
    asking: "Asking the source...",
  },

  bitcoin: {
    title: "Bitcoin",
    hint: "Price, positions and the state of the network",
    live30s: "30 sec",
    noPrice: "No price",
    emptyNote: "The chain explorer didn't answer",
    exchangePrice: "Price on the exchange",
    change24hTitle: "Price change over the day",
    openInterest: { label: "Open interest", hint: "How much money sits in open futures positions" },
    funding8h: "8h rate",
    noRate: "The exchange didn't quote a rate",
    longsPay: "Positive rate: longs are paying",
    shortsPay: "Negative rate: shorts are paying",
    feeLabel: "Transfer fee, satoshis per byte",
    feeFastest: { label: "Urgent", hint: "Get into the next block" },
    feeHalfHour: { label: "Half hour", hint: "Confirmation in about half an hour" },
    feeHour: { label: "An hour", hint: "Confirmation in about an hour" },
    feeEconomy: { label: "No rush", hint: "When time doesn't matter" },
    hashrate: { label: "Network hashrate", hint: "The miners' combined computing power" },
    txPerDay: { label: "Transfers per day", hint: "How many transactions the network processed in a day" },
    retarget: "Difficulty retarget",
    retargetTitle: "How much mining difficulty will change at the end of the period",
    retargetProgress: (pct: string) => `${pct}% of the period done`,
    priceHint: "Price, positions and two days of candles",
    networkTitle: "Bitcoin network",
    networkHint: "Fees, hash rate and transfers",
  },

  /** Decoration column in Pulse: banners, a quote and a step to the terminal. */
  promo: {
    quote: "The best traders don't predict the market - they're ready for any scenario.",
    author: "NMNH",
    cta: ["Trade", "with knowledge"],
    ctaHint: "Open the terminal",
    bitcoinAlt: "Bitcoin leads the market",
    globalAlt: "The global market always moves",
    smartAlt: "Smart Money: follow the big players. Open the maps",
  },

  fearGreed: {
    title: "Fear and greed",
    hint: "Market sentiment from 0 to 100",
    emptyNote: "The index is unavailable right now",
    daysAgo30: "30 days ago",
    today: "today",
    yesterday: "Yesterday",
    weekAgo: "A week ago",
    monthAgo: "A month ago",
    levels: {
      extremeFear: "Extreme fear",
      fear: "Fear",
      neutral: "Neutral",
      greed: "Greed",
      extremeGreed: "Extreme greed",
    },
  },

  funding: {
    title: "Funding",
    hintDefault: "Who pays to hold a position",
    hintLongsPay: (n: number, total: number) => `Longs are paying on ${n} of ${total} instruments`,
    live5m: "5 min",
    emptyNote: "The exchange didn't return the rates",
    colInstrument: "Instrument",
    colRate: "Rate",
    colSkew: "Skew",
    colSettle: "Settles in",
    soon: "soon",
    countdown: (h: number, m: number) => (h > 0 ? `${h}h ${m}m` : `${m}m`),
    noRateFor: "The exchange didn't quote a rate for this instrument",
    longsPay: "Positive rate: longs are paying",
    shortsPay: "Negative rate: shorts are paying",
  },

  trending: {
    title: "Most searched",
    hint: "Attention arrives before volume",
    emptyNote: "The search list is unavailable",
    rankTitle: "Rank by market cap",
    priceInBtc: "price in BTC",
  },

  screener: {
    title: "Market screener",
    subtitle: (n: number) => `${n} instruments · metrics computed by our server`,
    searchPlaceholder: "Coin",
    streamOn: "Stream is live",
    streamOff: "No connection",
    openInTerminal: "Open in the terminal",
    quietTitle: "The stream is silent on this coin",
    quiet: "quiet",
    notInList: "That coin isn't in the list",
    waitingFrame: "Waiting for the first frame from the server...",
    noStream: "No connection to the exchange stream",
    cols: {
      coin: { label: "Coin", hint: "The instrument and its price" },
      change: { label: "Chg. 24h", hint: "Price change over the day" },
      volume: { label: "Volume 24h", hint: "How much was traded in a day" },
      wall: { label: "Wall", hint: "A large order near the price and its distance in basis points" },
      imbalance: { label: "Imbalance", hint: "Which side of the book is denser" },
      delta: { label: "Delta", hint: "Market buys minus market sells over a minute" },
      range: { label: "Range", hint: "Price range over a minute, basis points" },
      spread: { label: "Spread", hint: "The gap between best prices, basis points" },
      trades: { label: "Trades/min", hint: "How often market trades happen" },
    },
    bidsDenser: "The buy side is denser",
    asksDenser: "The sell side is denser",
    bigBid: "A large buy order below the price",
    bigAsk: "A large sell order above the price",
  },

  ticker: {
    biggestWall: "the biggest wall in the list",
    wall: (money: string) => `wall ${money}`,
    openChart: "open the chart and order book",
  },

  orderBook: {
    book: "Order book",
    trades: "Trades",
    time: "Time",
    price: "Price",
    priceUsdt: "Price (USDT)",
    amount: (ticker: string) => `Amount (${ticker})`,
    total: (ticker: string) => `Total (${ticker})`,
    spread: (value: string | null) => `Spread ${value}`,
  },

  overlay: {
    closeTitle: "Close (Esc)",
  },
};
