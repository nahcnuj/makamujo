export type AgentStatusRow = {
  label: string
  value: string
  href?: string
};

export type AgentStatusSection = {
  title: string
  rows: AgentStatusRow[]
};

export type LiveDeliveryStatusSectionProps = {
  liveDeliveryRows: AgentStatusRow[]
};

export type MarkovModelStatusSectionProps = {
  markovModelRows: AgentStatusRow[]
};

export type GameStatusSectionProps = {
  gameRows: AgentStatusRow[]
};
