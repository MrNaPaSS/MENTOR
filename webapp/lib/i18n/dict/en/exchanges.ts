// Exchange showcase in the account area: where the terminal trades, what an
// academy account gives, and how to connect one.

export const exchanges = {
  title: "Exchanges",
  hint: "Where the terminal trades and what an academy account gives",
  lead:
    "An exchange opens once the academy confirms it: send the UID of your account there to the academy bot, and it shows up here with a connect button. How much of the fee comes back and where it lands is written on every card.",

  state: {
    active: "active",
    connected: "connected",
    notConnected: "not connected",
    trading: "trading",
    soon: "soon",
    ownBook: "own book",
    sharedBook: "shared book",
  },

  broker: {
    talks: "in talks",
    applied: "application sent",
    live: "broker ID received",
  },

  terms: {
    taker: "taker",
    maker: "maker",
    academy: "academy rate",
    unknown: "terms being agreed",
    note:
      "Reference rates for tier zero: yours is derived from your own trades and always wins. " +
      "The cashback lands on your exchange account, not on a terminal balance, and is counted from the " +
      "exchange's own reports - the same numbers you saw in the academy bot.",
  },

  payout: {
    pays: (pct: string) => `${pct} of your fee comes back`,
    where: (name: string) =>
      `Lands on your ${name} account: for trades made in the terminal from an account opened through the academy link.`,
    forbidden: "No cashback here: the exchange forbids partners from sharing fees with traders.",
    unknown: "The exchange has not named the share yet - it shows up here once it does.",
    waiting: "The exchange is not connected yet, so there are no terms for it.",
  },

  access: {
    academy: "Opened through the academy: part of the fee comes back to it.",
    own: "Your own account: the terminal works, academy terms do not apply.",
    uid: (uid: string) => `Account ${uid}`,
    needsAcademy:
      "The exchange opens once the academy confirms it: send the UID of your account there " +
      "to the academy bot. Once confirmed, you can connect it here.",
    confirmed: (uids: string) => `Confirmed by the academy: ${uids}`,
  },

  actions: {
    login: "Sign in with the exchange",
    loginSoon: "Exchange sign-in arrives with the broker ID",
    signup: "Open an account",
    keys: "Connect with API keys",
    needsAcademy: "Confirm the account in the academy bot first",
    replace: "Replace keys",
    makeActive: "Place orders from here",
    disconnect: "Disconnect",
    open: "Open the terminal",
  },

  auth: {
    keys: "with keys",
    oauth: "with exchange sign-in",
  },

  login: {
    working: "Waiting for the exchange",
    done: "Account connected",
    failed: "Sign-in failed",
    cancelled: "Sign-in cancelled",
  },

  empty: "No accounts yet: connect the first one and the terminal starts placing orders.",
  vaultOff: "Connecting is off: the server has no encryption key configured.",
};
