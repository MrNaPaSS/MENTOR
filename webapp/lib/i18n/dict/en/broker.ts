// Broker programme page. Same promise as the Russian version, same numbers:
// nothing here is softened for the English reader, and everything that is not
// connected yet still says so out loud.

export const broker = {
  meta: {
    title: "Exchange fee rebates with no subscription - NMNH broker programme",
    description:
      "Trade in the NMNH terminal and get up to 40% of your exchange fees back. No monthly plans: the full terminal, risk manager and journal are open to everyone. WEEX is live.",
  },

  nav: {
    how: "How it works",
    calculator: "Calculator",
    plans: "Why no plans",
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
      "Up to 40% of fees back",
      "Zero subscription",
      "Your money stays on your exchange",
    ],
    ctaPrimary: "Calculate your rebate",
    ctaSecondary: "Open the terminal",
    imageAlt:
      "NMNH trading terminal on two laptops: order book, footprint chart and time and sales",
    ticker: {
      label: "Rebate by tier",
      from: "from",
      note: "Your tier grows with 30-day volume, not with how much you paid us.",
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
        text: "From 25 to 40% of your own fees, based on 30-day volume. The remainder is our revenue, and we have no other.",
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
      "Move the volume and the trading style. Calculated from the exchange's public rate and the programme tiers - the same formulas the payouts use.",
    volumeLabel: "30-day volume",
    volumeHint: "Total of entries and exits, not your deposit.",
    styleLabel: "Trading style",
    styleHint: "How much of your volume you take at market instead of posting limits.",
    styleMaker: "Limit only",
    styleTaker: "Market only",
    exchangeLabel: "Exchange",
    exchangeSoon: "soon",
    results: {
      commission: "Fees per month",
      commissionHint: (rate: string) => `Blended rate ${rate}`,
      cashback: "Rebate per month",
      cashbackHint: (share: string) => `Tier pays ${share} of fees`,
      effective: "Your rate after the rebate",
      effectiveHint: (from: string, to: string) => `Was ${from}, now ${to}`,
      yearly: "Kept over a year",
      yearlyHint: "Twelve months of rebates in a row",
    },
    versus: {
      title: "The same trader on a subscription",
      subtitle:
        "A typical crypto broker plan: $99 a month for a promise to return 45% of fees.",
      theirCashback: "Their rebate",
      theirPrice: "Minus the plan",
      theirNet: "Left in hand",
      ourNet: "Left with NMNH",
      advantageWin: (sum: string) => `${sum} a year of difference in your favour`,
      advantageLose: (sum: string) =>
        `At this volume the subscription beats us by ${sum} a year. We say it plainly instead of hiding it in a footnote.`,
      lossNote:
        "The negative number is not a typo. At this volume the monthly fee exceeds the rebate, so the trader pays for the right to receive their own money.",
    },
    disclaimer:
      "This is an estimate: your rate depends on your VIP level, and exchange affiliate rates get revised. Payouts follow the exchange's confirmed reports, not this number.",
  },

  plans: {
    eyebrow: "Plans",
    title: "Why we do not have any",
    subtitle:
      "The subscription model looks fair until you sit down with the numbers. We did. Here is what came out.",
    breakeven: {
      title: "When the monthly fee pays for itself",
      subtitle:
        "The 30-day volume below which a plan takes more than it returns. Taker rate 0.05%.",
      planColumn: "Plan",
      shareColumn: "Promised rebate",
      volumeColumn: "Volume to break even",
      priceSuffix: "$/mo",
    },
    upgrade: {
      title: "And when an upgrade pays for itself",
      subtitle:
        "The gap between tiers is two to five points of rebate for twenty to seventy dollars more. Here is the volume at which that difference returns the money.",
      from: "from",
      to: "to",
      volume: "requires volume",
      verdict:
        "Millions in monthly volume means a full-time scalper. Everyone else is sold the percentage and pays for the features.",
    },
    cuts: {
      title: "And what gets locked behind tiers",
      subtitle: "Rows from a real price list. On the right: where it sits with us.",
      ours: "With us",
      oursValue: "everyone",
      lockedOn: (plan: string) => `${plan} only`,
      rows: {
        workspaces: "More than one workspace",
        widgets: "Unlimited widgets",
        history: "Full trade history in the journal",
        dailyLossLimit: "Daily losing-trade limit",
        withdrawLock: "Withdrawal lock when the risk manager fires",
        subaccountLock: "Sub-account transfer lock",
        alertGroups: "Alert groups",
        customDashboard: "Custom journal dashboard",
        simulator: "Replay simulator",
        vipSupport: "Priority support",
      },
      verdict: {
        title: "Two rows on this list should never be for sale",
        text:
          "A daily losing-trade limit and a withdrawal lock when the risk manager fires are not conveniences. They are protection for the day someone starts revenge trading, and they matter most to the trader who does not have a spare hundred dollars a month. Ours are on for everyone, always.",
      },
    },
  },

  included: {
    eyebrow: "Workstation",
    title: "What everyone gets",
    subtitle: "Not an upsell tier, just what we trade on ourselves every day.",
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

  exchanges: {
    eyebrow: "Exchanges",
    title: "Where this already works",
    subtitle:
      "An honest list. The connected exchange comes first, the rest are waiting their turn and labelled for what they are.",
    columns: {
      exchange: "Exchange",
      maker: "Maker",
      taker: "Taker",
      effective: "Taker after rebate",
      status: "Status",
    },
    status: {
      live: "Live",
      connecting: "Partnered, connecting",
      planned: "Application in preparation",
    },
    note: (share: string) =>
      `The "after rebate" column uses the ${share} tier - the base one, which every participant gets from day one.`,
    rateNote:
      "Rates are set by the exchange, not by us. Where the base taker fee is higher, the rebate does not fully close the gap - there is a separate question about that below.",
    waitlist: {
      title: "Not trading on WEEX?",
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

  faq: {
    eyebrow: "Questions",
    title: "The awkward questions",
    subtitle: "The ones usually buried at the bottom of the page.",
    items: [
      {
        tag: "Catch",
        q: "What is the catch if the terminal is free?",
        a: "There is no catch, there is a revenue source. The exchange rebates part of the fees on volume routed through NMNH, and the gap between that rebate and your cashback is all we earn. So we only earn when you do, and it is against our interest for you to blow up the account and leave.",
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
        a: "True: 0.08% against 0.05%, and the rebate does not fully close that gap. Three things change the picture. The rebate on WEEX works today, while on the cheaper exchange neither we nor you have one yet. The maker fee is the same 0.02% everywhere, so a trader who enters with limits barely feels the difference. And WEEX has its own VIP ladder: the taker fee drops as volume grows. If you take everything at market and your volume is large, the honest answer is to wait for your exchange to be connected, and we will say when that happens.",
      },
      {
        tag: "Tiers",
        q: "Why can't the tier be bought?",
        a: "Because then we would start earning from people who barely trade, and those are exactly the people with nothing to spare. The tier grows with 30-day volume, like VIP levels on the exchange itself.",
      },
      {
        tag: "Risk",
        q: "What if the exchange cuts its affiliate rate?",
        a: "Then the rebate ceiling drops, and we will say so up front. Exchange rates get revised - Binance does it quarterly - and promising a fixed percentage forever would be a lie. Terms are stored as dated versions: past days are recalculated at the rate that applied then, and nothing is edited retroactively.",
      },
      {
        tag: "Coverage",
        q: "Why only WEEX when there are a dozen exchanges?",
        a: "Because one is connected. Limit calculation, fees and trade management are built on WEEX, the partnership is confirmed, and the programme runs there today. Applications for the others are in progress, and until they are connected they say \"soon\" instead of appearing as logos in the footer.",
      },
      {
        tag: "Binance",
        q: "Is it true that cashback is banned on Binance?",
        a: "It is. Binance forbids affiliates from returning fees to users and cuts the rate for it, and it only counts new users without another referral code. So when we connect there, the benefit will not be in cash, and we will write that on the page rather than let you discover it after signing up.",
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
