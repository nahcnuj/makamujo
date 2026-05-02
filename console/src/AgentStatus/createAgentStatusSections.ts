import type { AgentStateResponse, AgentStatusSection } from "./types";
import { createAgentStatusRows } from "./createAgentStatusRows";
import { LIVE_DELIVERY_SECTION_TITLE } from "./LiveDeliveryStatusSection";
import { MARKOV_MODEL_SECTION_TITLE } from "./MarkovModelStatusSection";

const LIVE_DELIVERY_ROW_LABELS = ["配信指標", "タイトル", "配信URL", "開始時刻", "発話内容"] as const;
const MARKOV_MODEL_ROW_LABELS = ["生成N-gram", "返信先コメント", "これまでの発話"] as const;
const GAME_ROW_LABELS = ["ゲーム情報"] as const;

const createLabelSet = (labels: readonly string[]) => new Set<string>(labels);
const LIVE_DELIVERY_ROW_LABEL_SET = createLabelSet(LIVE_DELIVERY_ROW_LABELS);
const MARKOV_MODEL_ROW_LABEL_SET = createLabelSet(MARKOV_MODEL_ROW_LABELS);
const GAME_ROW_LABEL_SET = createLabelSet(GAME_ROW_LABELS);

export const createAgentStatusSections = (stateResponse: AgentStateResponse | null): AgentStatusSection[] => {
  const rows = createAgentStatusRows(stateResponse);
  const liveDeliveryRows = rows.filter((row) => LIVE_DELIVERY_ROW_LABEL_SET.has(row.label));
  const markovModelRows = rows.filter((row) => MARKOV_MODEL_ROW_LABEL_SET.has(row.label));
  const gameRows = rows.filter((row) => GAME_ROW_LABEL_SET.has(row.label));

  const shouldShowGameSection = stateResponse !== null && stateResponse !== undefined;
  const gameSectionTitle = stateResponse?.currentGame?.name
    ? `『${stateResponse.currentGame.name}』プレイ中`
    : "『-』プレイ中";

  const sections = [
    { title: "配信状況", rows: liveDeliveryRows },
    { title: "マルコフ連鎖モデル", rows: markovModelRows },
    ...(shouldShowGameSection ? [{ title: gameSectionTitle, rows: gameRows }] : []),
  ];

  return sections.filter((section) => section.rows.length > 0 || section.title === gameSectionTitle);
};
