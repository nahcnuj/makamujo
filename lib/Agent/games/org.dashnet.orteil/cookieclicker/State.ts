type Product = {
  name: string
  mult: number
  price: number
  enabled: boolean
};

type Upgrade = {
  enabled: boolean
};

type Tech = {
  enabled: boolean
};

type Switch = {
  description?: string
  enabled: boolean
};

export type Statistics = {
  general: {
    [key in string]: {
      innerText: string
    }
  } & {
    // cookiesInBank: {
    //   value: number
    // }
    // cookiesBakedInThisAscension: {
    //   value: number
    // }
    // cookiesBakedInTotal: {
    //   value: number
    // }
    // cookiesForfeitedByAscending: {
    //   value: number
    // }
    '遺産の始まり：'?: {
      innerText: string
      /** 「昇天 N 回」（パースできれば） */
      ascensions?: number
      /** 「N 日前」（パースできれば） */
      daysAgo?: number
    }
    // buildingsOwned: {
    //   value: number
    // }
    // cookiesPerClick: {
    //   value: number
    // }
    'クリック回数：'?: {
      innerText: string
      /** パースできれば */
      value?: number
    }
    // handmadeCookies: {
    //   value: number
    // }
  }
};

export type State = {
  cookies: number
  cps: number
  isWrinkled: boolean
  ascendNumber: number
  commentsText?: string
  /** News ticker lines (#commentsText1 / #commentsText2). */
  newsLines?: string[]
  store: {
    products: {
      bulkMode: 'buy' | 'sell'
      items: Product[]
    }
    upgrades: Upgrade[]
    tech: Tech[]
    switches: Switch[]
  }
  statistics?: Statistics
};
