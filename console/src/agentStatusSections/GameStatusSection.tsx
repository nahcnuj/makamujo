import { AgentStatusSectionCard } from "./AgentStatusSectionCard";
import type { AgentStatusRow } from "./AgentStatusSectionCard";

export const GAME_SECTION_TITLE = "ゲームの状態";

type GameStatusSectionProps = {
  gameRows: AgentStatusRow[]
};

export const GameStatusSection = ({ gameRows }: GameStatusSectionProps) => {
  return <AgentStatusSectionCard title={GAME_SECTION_TITLE} rows={gameRows} />;
};
