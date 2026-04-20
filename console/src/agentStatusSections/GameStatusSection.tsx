import { GAME_SECTION_TITLE } from "./constants";
import type { GameStatusSectionProps } from "./types";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

export const GameStatusSection = ({ gameRows }: GameStatusSectionProps) => {
  return <AgentStatusSectionCard title={GAME_SECTION_TITLE} rows={gameRows} />;
};
