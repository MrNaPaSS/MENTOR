// Broker programme page. Same promise as the Russian version, same numbers:
// nothing here is softened for the English reader, and everything that is not
// connected yet still says so out loud.

export const broker = {
  meta: {
    title: "Exchange fee rebates with no subscription",
    description:
      "Trade in the NMNH terminal and get part of your exchange fees back: 15% on WEEX, 10% on OKX and BingX. No monthly plans - the full terminal, risk manager and journal are open to everyone.",
  },

  nav: {
    how: "How it works",
    calculator: "Calculator",
    exchanges: "Exchanges",
    faq: "Questions",
  },

  hero: {
    eyebrow: "NMNH broker programme",
    titleTop: "Fees are not a tax.",
    titleAccent: "You get them back.",
    lead:
      "You already pay the exchange on every trade. Trade through the NMNH terminal and part of that money comes back to you, while the workstation stays free - all of it, no tiers, no monthly fee.",
    bullets: [
      "Up to 15% of fees back",
      "Zero subscription",
      "Your money stays on your exchange",
    ],
    ctaPrimary: "Calculate your rebate",
    ctaSecondary: "Open the terminal",
    imageAlt:
      "NMNH trading terminal on two laptops: order book, footprint chart and time and sales",
    today: {
      label: "Cashback today",
      note: "Open the account through the academy link, trade in the terminal - the cashback lands on your account at the exchange.",
    },
    ticker: {
      label: "What comes next",
      from: "from",
      note: "The 30-day volume ladder switches on together with broker status - the applications are in, we are waiting for answers.",
    },
  },

  flow: {
    eyebrow: "Mechanics",
    title: "Where the money comes from",
    subtitle:
      "No magic and none of our own money. Exchanges share fees with venues that bring them volume, and we share with you.",
    steps: [
      {
        title: "You pay the exchange",
        text: "Same as always. The exchange sets the rate and charges your account there.",
      },
      {
        title: "The exchange rebates part of it to us",
        text: "For volume routed through NMNH. This is standard affiliate mechanics, every major exchange runs it.",
      },
      {
        title: "We pass part of it back to you",
        text: "Today that is 15% of your own fees on WEEX and 10% on OKX and BingX. It lands on your exchange account, counted from the exchange's own reports.",
      },
    ],
    footnote:
      "That is why the terminal is free and stays free: we earn only when you trade. Trade nothing and you pay nothing, to anyone.",
    diagram: {
      trader: "Trader",
      exchange: "Exchange",
      nmnh: "NMNH",
      commission: "fees",
      rebate: "rebate",
      cashback: "back to you",
      margin: "our share",
    },
  },

  calculator: {
    eyebrow: "Calculator",
    title: "What comes back to you",
    subtitle:
      "Move the volume and the trading style. Calculated from the exchange's public rate and its own cashback share - the same formulas the payouts use.",
    volumeLabel: "30-day volume",
    volumeHint: "Total of entries and exits, not your deposit.",
    styleLabel: "Trading style",
    styleHint: "How much of your volume you take at market instead of posting limits.",
    styleMaker: "Limit only",
    styleTaker: "Market only",
    exchangeLabel: "Exchange",
    exchangeSoon: "soon",
    exchangeNoCashback: "no cashback",
    exchangeCashbackSoon: "cashback tbd",
    results: {
      commission: "Fees per month",
      commissionHint: (rate: string) => `Blended rate ${rate}`,
      cashback: "Rebate per month",
      cashbackHint: (share: string) => `${share} of the fee back on this exchange`,
      effective: "Your rate after the rebate",
      effectiveHint: (from: string, to: string) => `Was ${from}, now ${to}`,
      yearly: "Kept over a year",
      yearlyHint: "Twelve months of rebates in a row",
    },
    disclaimer:
      "This is an estimate: your rate depends on your VIP level, and exchange affiliate rates get revised. Payouts follow the exchange's confirmed reports, not this number.",
  },


  included: {
    eyebrow: "Workstation",
    title: "What everyone gets",
    subtitle: "What we trade on ourselves every day. One terminal for everyone, no access levels.",
    items: [
      {
        title: "Order book, footprint and tape",
        text: "Liquidity walls, volume inside the candle and a market-wide screener, live.",
      },
      {
        title: "Levels you drag with the mouse",
        text: "Drag the stop on the chart and the order on the exchange moves with it. No dialogs, no confirmations.",
      },
      {
        title: "Risk sized before you enter",
        text: "Position size against your deposit, lot step, leverage cap and the symbol's fee are all in the calculation.",
      },
      {
        title: "The server manages the position",
        text: "Target hit, stop moves to break-even. The server does it, not a browser tab, and it works while you sleep.",
      },
      {
        title: "Journal built from exchange reports",
        text: "Result, fees and target fills come from exchange data, not from what you remember about the trade.",
      },
      {
        title: "Keys with no withdrawal rights",
        text: "The key is trade-only, encrypted on the server and never returned to the browser. Unlink it in one click.",
      },
    ],
  },

  tour: {
    eyebrow: "The desk",
    title: "What it looks like at work",
    subtitle:
      "The four things the terminal was built for. Open to everyone, right away.",
    items: [
      {
        title: "Terminal",
        text:
          "Order book with walls, clusters and tape on one screen. Orders are placed from the chart: drag a level and the order on the exchange follows.",
        points: ["Book and clusters", "Levels by mouse", "Each account sees its own exchange"],
        image: "/art/broker/terminal.jpg",
        webp: "/art/broker/terminal.webp",
        alt: "NMNH terminal: order book, clusters and a chart with the trade drawn on it",
      },
      {
        title: "Trade journal",
        text:
          "A trade lands in the journal by itself, with the exit price and the fee the exchange charged - not our estimate. Days, sides, coins and hours are counted from those same records.",
        points: ["Writes itself", "Real exchange numbers", "Split by exchange"],
        image: "",
        webp: "",
        alt: "Trade journal: closed trades with the day's result",
      },
      {
        title: "Sizing before entry",
        text:
          "Position size against your deposit and risk, lot step, leverage ceiling and the coin's fee - all counted before the order leaves. There is nowhere to miss a zero.",
        points: ["Risk in percent", "Exchange limits applied", "Ladder of targets"],
        image: "",
        webp: "",
        alt: "Trade sizing: risk, size and the ladder of targets",
      },
      {
        title: "The desk on your phone",
        text:
          "The account area installs on a phone like an app - no stores, no downloads. The trade is visible where it happens.",
        points: ["Installs from the site", "Event notifications", "The same account"],
        image: "",
        webp: "",
        alt: "NMNH account area on a phone",
      },
    ],
  },

  exchanges: {
    eyebrow: "Exchanges",
    title: "Where this already works",
    subtitle:
      "An honest list. Connected exchanges come first, the rest are waiting their turn and labelled for what they are.",
    columns: {
      exchange: "Exchange",
      maker: "Maker",
      taker: "Taker",
      cashback: "Cashback",
      effective: "Taker after rebate",
      status: "Status",
    },
    status: {
      live: "Live",
      soon: "Soon",
    },
    cashbackNo: "not allowed by the exchange",
    cashbackSoon: "being agreed",
    note:
      "The \"after rebate\" column uses each exchange's own share rather than one common number: the shares differ, and a single figure would be wrong in half the rows.",
    rateNote:
      "Rates are set by the exchange, not by us. Where the base taker fee is higher, the rebate does not fully close the gap - there is a separate question about that below.",
    waitlist: {
      title: "Your exchange not on the list?",
      text: "Tell us in the chat which exchange you need: the connection queue follows demand, not the alphabet.",
      button: "Message on Telegram",
    },
  },

  steps: {
    eyebrow: "Getting started",
    title: "Four steps, seven minutes",
    subtitle: "No applications, no interviews, no waiting for approval.",
    items: [
      {
        title: "Open an exchange account",
        text: "Through the academy link - that is what ties your volume to the programme. The account is yours, the money is yours.",
      },
      {
        title: "Create an API key",
        text: "Trade-only, no withdrawal rights. Step-by-step instructions with screenshots are inside.",
      },
      {
        title: "Connect the key to the terminal",
        text: "One minute. After that the book, chart and positions all work against your account.",
      },
      {
        title: "Trade the way you traded",
        text: "The rebate is calculated automatically from exchange reports. Nothing to click, nobody to ask.",
      },
    ],
  },

  help: {
    eyebrow: "If you get stuck",
    title: "Start in fifteen minutes",
    text:
      "The key, the first trade and the markup - in one conversation. Write to the academy bot; a person answers, not an autoresponder.",
    action: "Message the mentor",
    note: "Free and without an appointment: that is what the academy is for.",
  },

  faq: {
    eyebrow: "Questions",
    title: "The awkward questions",
    subtitle: "The ones usually buried at the bottom of the page.",
    items: [
      {
        tag: "Catch",
        q: "What is the catch if the terminal is free?",
        a: "There is no catch, there is a revenue source. Exchanges pay venues for the volume routed through them, and we share part of that with you. So it only works out for us when you trade, and it is against our interest for you to blow up the account and leave.",
      },
      {
        tag: "Custody",
        q: "Where is my money held?",
        a: "In your account on the exchange. NMNH takes no deposits, holds no funds and cannot move them: the API key is created without withdrawal rights. We place orders, the exchange holds balance, margin and execution.",
      },
      {
        tag: "Rate",
        q: "Will my fees go up because of a middleman?",
        a: "No. The exchange sets the rate and it is the same one you would pay without us. The only change is that part of what you paid comes back.",
      },
      {
        tag: "Rates",
        q: "WEEX takers cost more than Binance. Where is the benefit?",
        a: "True: 0.08% against 0.05%, and a 15% rebate does not fully close that gap. Three things change the picture. The rebate on WEEX works today, while on Binance there will be none at all - the exchange forbids partners from sharing fees. The maker fee is the same 0.02% everywhere, so a trader who enters with limits barely feels the difference. And WEEX has its own VIP ladder: the taker fee drops as volume grows. If you take everything at market and your volume is large, run your own exchange through the calculator above - it will give you that answer too.",
      },
      {
        tag: "Tiers",
        q: "Why can't the tier be bought?",
        a: "Because then we would start earning from people who barely trade, and those are exactly the people with nothing to spare. The tier grows with 30-day volume, like VIP levels on the exchange itself. The ladder is not running yet: it switches on together with broker status, and until then cashback follows the affiliate model, with its own share on each exchange.",
      },
      {
        tag: "Risk",
        q: "What if the exchange cuts its affiliate rate?",
        a: "Then the rebate ceiling drops, and we will say so up front. Exchange rates get revised - Binance does it quarterly - and promising a fixed percentage forever would be a lie. Terms are stored as dated versions: past days are recalculated at the rate that applied then, and nothing is edited retroactively.",
      },
      {
        tag: "Coverage",
        q: "Which exchanges does this work on today?",
        a: "Trading is connected on five - WEEX, OKX, BingX, MEXC and Binance. Cashback runs on three of them: WEEX 15%, OKX and BingX 10% each. In total we work with more than 8 official exchanges; the rest are pending, and until they are connected they say \"soon\" instead of appearing as logos in the footer.",
      },
      {
        tag: "Binance",
        q: "Is it true that cashback is banned on Binance?",
        a: "It is. Binance forbids affiliates from returning fees to users and cuts the rate for it, and it only counts new users without another referral code. Trading on Binance has worked in the terminal since September 2026, and there is no cashback there and never will be - it says so in the table above rather than turning up after you sign up.",
      },
      {
        tag: "Payouts",
        q: "When and how does the rebate arrive?",
        a: "On the exchange's confirmed reports, in USDT. Estimates before the report are shown separately and labelled as estimates: paying out on a guess and then clawing back the difference is the worst thing you can do in a programme about money.",
      },
      {
        tag: "Leaving",
        q: "What happens if I want to leave?",
        a: "You unlink the key and leave. The exchange account stays yours, the trade history exports, and there is nothing we could lock or withhold - which is the whole point of a model where the money never reaches us.",
      },
    ],
    ctaTitle: "Still have a question that is not here?",
    ctaText: "Ask in the academy chat - a real person answers, not a contact form.",
    ctaButton: "Ask a question",
  },

  cta: {
    title: "Last month's fees are already paid",
    text: "Those you cannot get back. Next month's you can start recovering today, and it takes seven minutes.",
    primary: "Open the terminal",
    secondary: "Open a WEEX account",
    note: "No subscription, no application, no call with a manager.",
  },
};
