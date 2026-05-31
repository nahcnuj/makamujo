import type { AgentStateResponse, AgentStatusRow } from "./types";
import {
  createCurrentGameInfoValueComponent,
  createLiveDeliveryMetricsValueComponent,
  createRecentCommentsValueComponent,
  createReplyTargetCommentValueComponent,
  createSpeechHistoryDisplayItems,
  formatNGramValue,
  getSpeechUnavailableIndicator,
  normalizeSpeechText,
} from "./agentStatusUtils";
import { SpeechHistoryList } from "./SpeechHistoryList";

export const createAgentStatusRows = (
  stateResponse: AgentStateResponse | null,
  options?: {
    showRecentComments?: boolean;
    toggleRecentComments?: () => void;
  },
): AgentStatusRow[] => {
  const rows: AgentStatusRow[] = [];

  const niconamaState = stateResponse?.niconama;
  // Prefer an explicit top-level `commentCount`, otherwise fall back to
  // the `niconama.meta.total.comments` value which some producers emit.
  const resolvedCommentCount = typeof stateResponse?.commentCount === 'number'
    ? stateResponse!.commentCount
    : typeof niconamaState?.meta?.total?.comments === 'number'
      ? niconamaState!.meta!.total!.comments
      : undefined;

  if (niconamaState && Object.keys(niconamaState).length > 0) {
    rows.push(
      {
        label: "配信指標",
        hideLabel: true,
        valueComponent: createLiveDeliveryMetricsValueComponent(
          niconamaState,
          resolvedCommentCount,
          options?.showRecentComments,
          options?.toggleRecentComments,
        ),
      },
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

  const replyTargetComment = stateResponse?.replyTargetComment?.text
    ? stateResponse.replyTargetComment
    : undefined;

  const recentComments = Array.isArray(stateResponse?.recentComments)
    ? stateResponse.recentComments.filter((item): item is import("automated-gameplay-transmitter").AgentComment => typeof item === 'object' && item !== null)
    : [];

  const isSpeechSilent = stateResponse?.speech?.silent === true;
  const speechHistoryItems = createSpeechHistoryDisplayItems(stateResponse?.speechHistory);
  if (recentComments.length > 0 && options?.showRecentComments) {
    rows.push({
      label: "最近のコメント",
      valueComponent: createRecentCommentsValueComponent(recentComments),
    });
  }

  if (speechHistoryItems.length > 0) {
    rows.push({
      label: "これまでの発話",
      hideLabel: true,
      valueComponent: (
        <SpeechHistoryList
          initialItems={speechHistoryItems}
          emphasizeLatest={!isSpeechSilent}
        />
      ),
    });
  } else if (replyTargetComment) {
    rows.push({
      label: "返信先コメント",
      valueComponent: createReplyTargetCommentValueComponent(replyTargetComment),
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
