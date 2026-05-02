import type { AgentStateResponse, AgentStatusRow } from "./types";
import {
  createCurrentGameInfoValueComponent,
  createLiveDeliveryMetricsValueComponent,
  createSpeechHistoryDisplayItems,
  createSpeechHistoryValueComponent,
  formatNGramValue,
  formatStartDate,
  getSpeechUnavailableIndicator,
  normalizeSpeechText,
} from "./agentStatusUtils";

export const createAgentStatusRows = (stateResponse: AgentStateResponse | null): AgentStatusRow[] => {
  const rows: AgentStatusRow[] = [];

  const niconamaState = stateResponse?.niconama;
  if (niconamaState && Object.keys(niconamaState).length > 0) {
    rows.push(
      { label: "配信指標", hideLabel: true, valueComponent: createLiveDeliveryMetricsValueComponent(niconamaState) },
    );
  }

  if (stateResponse !== null && stateResponse !== undefined && "currentGame" in stateResponse) {
    rows.push({ label: "現在のゲーム", value: stateResponse.currentGame?.name ?? "-" });
    rows.push({
      label: "ゲーム情報",
      valueComponent: createCurrentGameInfoValueComponent(stateResponse.currentGame?.state),
    });
  }

  if (stateResponse?.nGram !== undefined) {
    rows.push({ label: "生成N-gram", value: formatNGramValue(stateResponse.nGram, stateResponse.nGramRaw) });
  }

  if (createSpeechHistoryDisplayItems(stateResponse?.speechHistory).length > 0) {
    rows.push({
      label: "これまでの発話",
      hideLabel: true,
      valueComponent: createSpeechHistoryValueComponent(stateResponse?.speechHistory),
    });
  }

  if (stateResponse?.canSpeak === false) {
    rows.push({ label: "発話内容", value: getSpeechUnavailableIndicator() });
  } else if (stateResponse?.speech !== undefined) {
    rows.push({ label: "発話内容", value: normalizeSpeechText(stateResponse.speech) ?? "-" });
  }

  return rows;
};
