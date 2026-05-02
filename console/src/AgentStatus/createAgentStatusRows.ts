import type { AgentStateResponse, AgentStatusRow } from "./types";
import {
  createCurrentGameInfoValueComponent,
  createLiveDeliveryMetricsValueComponent,
  createReplyTargetCommentValueComponent,
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
      { label: "配信指標", hideLabel: true, valueComponent: createLiveDeliveryMetricsValueComponent(niconamaState, stateResponse?.commentCount) },
    );
  }

  if (stateResponse !== null && stateResponse !== undefined && "currentGame" in stateResponse) {
    const currentGameName = stateResponse.currentGame?.name;
    const currentGameState = stateResponse.currentGame?.state;

    if (currentGameName !== undefined && currentGameState !== undefined) {
      rows.push({
        label: "ゲーム情報",
        hideLabel: true,
        valueComponent: createCurrentGameInfoValueComponent(currentGameState),
      });
    }
  }

  if (stateResponse?.nGram !== undefined) {
    rows.push({
      label: "生成N-gram",
      hideLabel: true,
      value: formatNGramValue(stateResponse.nGram, stateResponse.nGramRaw),
    });
  }

  if (stateResponse?.replyTargetComment?.text) {
    rows.push({
      label: "返信先コメント",
      hideLabel: true,
      valueComponent: createReplyTargetCommentValueComponent(stateResponse.replyTargetComment),
    });
  }

  const isSpeechSilent = stateResponse?.speech?.silent === true;
  const speechHistoryItems = createSpeechHistoryDisplayItems(stateResponse?.speechHistory);
  if (speechHistoryItems.length > 0) {
    rows.push({
      label: "これまでの発話",
      hideLabel: true,
      valueComponent: createSpeechHistoryValueComponent(stateResponse?.speechHistory, !isSpeechSilent),
    });
  }

  const normalizedSpeechText = normalizeSpeechText(stateResponse?.speech);
  const shouldRenderSpeechContent = stateResponse?.canSpeak === false
    || (normalizedSpeechText !== undefined && speechHistoryItems.length === 0)
    || (normalizedSpeechText !== undefined && speechHistoryItems[0]?.speechText !== normalizedSpeechText);

  if (!isSpeechSilent) {
    if (stateResponse?.canSpeak === false) {
      rows.push({ label: "発話内容", value: getSpeechUnavailableIndicator() });
    } else if (normalizedSpeechText !== undefined && shouldRenderSpeechContent) {
      rows.push({ label: "発話内容", value: normalizedSpeechText });
    }
  }

  return rows;
};
