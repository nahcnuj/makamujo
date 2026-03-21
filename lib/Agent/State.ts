import type { StreamState as AGTStreamState } from "automated-gameplay-transmitter";

export type StreamMeta = {
  title: string
  url: string
  start: number
  total?: {
    listeners: number
    gift: number
    ad: number
  }
};

export type AgentState = {
  agtStreamState: AGTStreamState
  meta?: StreamMeta
};

export type StreamState = AgentState;
