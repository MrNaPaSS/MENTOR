// Exchange showcase in the account area: where the terminal trades, what an
// academy account gives, and how to connect one.

export const exchanges = {
  title: "Exchanges",
  hint: "Where the terminal trades and what an academy account gives",
  lead:
    "You can connect an account on any exchange below. Through the academy - lower fees and cashback; your own account works in the terminal too, but without the academy terms.",

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
    academy: "via academy",
    cashback: "cashback",
    unknown: "terms being agreed",
    note: "Reference rates for tier zero. Yours is derived from your own trades and always wins over the reference one.",
  },

  access: {
    academy: "Opened through the academy: lower fees and cashback.",
    own: "Your own account: the terminal works, academy terms do not apply.",
    uid: (uid: string) => `Account ${uid}`,
    confirmed: (uids: string) => `Confirmed by the academy: ${uids}`,
  },

  actions: {
    login: "Sign in with the exchange",
    loginSoon: "Exchange sign-in arrives with the broker ID",
    keys: "Connect with API keys",
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
