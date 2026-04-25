import type { AgentStatusRow } from "./AgentStatusSectionCard";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

export const GAME_SECTION_TITLE = "ゲームの状態";

export const GameStatusSection = ({ gameRows }: { gameRows: AgentStatusRow[] }) => {
    return <AgentStatusSectionCard title={GAME_SECTION_TITLE} rows={gameRows} />;
};
