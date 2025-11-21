export type Action =
  | {
    action: 'click'
  }
  | {
    action: 'buyProduct'
    name: string
  }
  | {
    action: 'buyUpgrade'
    name?: string
  }
  | {
    action: 'research'
  }
  | {
    action: 'toggleSwitch'
    name: string
  }
  | {
    action: 'ascend'
  }
  | {
    action: 'reincarnate'
  }
  | {
    action: undefined
  }