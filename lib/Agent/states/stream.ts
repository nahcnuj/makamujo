export type StreamState =
  | {
    type: 'live'
    title: string
    url: string
    start: number
    total?: {
        listeners: number
        gift: number
        ad: number
    }
  }
