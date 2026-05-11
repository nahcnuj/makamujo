import { AgentStatusSectionCard } from "./AgentStatusSectionCard";
import type { AgentStatusRow } from "./types";

type GameStatusSectionProps = {
  title: string;
  gameRows: AgentStatusRow[];
  className?: string;
};

export const GameStatusSection = ({ title, gameRows, className }: GameStatusSectionProps) => {
  return <AgentStatusSectionCard title={title} rows={gameRows} className={className} />;
};
