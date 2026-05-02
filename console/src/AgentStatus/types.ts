import type { ReactNode } from "react";

export type AgentStatusRow = {
  label: string
  href?: string
  hideLabel?: boolean
} & (
  | {
    value: string
    valueComponent?: never
  }
  | {
    value?: never
    valueComponent: ReactNode
  }
);

export type AgentStatusSection = {
  title: string
  rows: AgentStatusRow[]
};

export type AgentStateResponse = {
  error?: string
  niconama?: {
    type?: string
    meta?: {
      title?: string
      url?: string
      start?: number
      total?: {
        listeners?: number
        gift?: number
        ad?: number
      }
    }
  }
  canSpeak?: boolean
  currentGame?: {
    name?: string
    state?: Record<string, unknown>
  } | null
  nGram?: number
  nGramRaw?: number
  speech?: {
    speech?: string | { text?: string; nodes?: readonly string[] } | { speech?: string; text?: string; nodes?: readonly string[] }
    silent?: boolean
  }
  speechHistory?: Array<{
    id?: string
    speech?: string | { text?: string; nodes?: readonly string[] }
    nGram?: number
    nGramRaw?: number
    nodes?: readonly string[]
  }>
  replyTargetComment?: {
    text?: string
    pickedTopic?: string
  }
  commentCount?: number
};
