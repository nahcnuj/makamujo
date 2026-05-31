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
import { getAgentCommentNumber, getCommentTextFromAgentComment } from "../../../lib/niconamaCommentClient.helpers";
import { SpeechHistoryList } from "./SpeechHistoryList";

const mergeRecentCommentEntries = (
  recentComments: import("automated-gameplay-transmitter").AgentComment[],
): import("automated-gameplay-transmitter").AgentComment[] => {
  const merged: import("automated-gameplay-transmitter").AgentComment[] = [];

  for (const comment of recentComments) {
    const text = getCommentTextFromAgentComment(comment);
    if (typeof text === 'string' && /^[0-9]+(?:,[0-9]{3})*$/.test(text.trim())) {
      const previous = merged[merged.length - 1];
      if (previous) {
        const previousText = getCommentTextFromAgentComment(previous);
        const previousNumber = getAgentCommentNumber(previous);
        if (typeof previousText === 'string' && !/^[0-9]+(?:,[0-9]{3})*$/.test(previousText.trim()) && previousNumber === undefined) {
          const previousData = (previous as any).data ?? previous;
          merged[merged.length - 1] = {
            data: {
              ...previousData,
              no: Number(text.replace(/,/g, '')),
            },
          } as import("automated-gameplay-transmitter").AgentComment;
          continue;
        }
      }
    }

    merged.push(comment);
  }

  return merged;
};

export const createAgentStatusRows = (
  stateResponse: AgentStateResponse | null,
  options?: {
    showRecentComments?: boolean;
    toggleRecentComments?: () => void;
  },
): AgentStatusRow[] => {
  const rows: AgentStatusRow[] = [];

  const niconamaState = stateResponse?.niconama;
  const recentComments = Array.isArray(stateResponse?.recentComments)
    ? mergeRecentCommentEntries(stateResponse.recentComments.filter((item): item is import("automated-gameplay-transmitter").AgentComment => typeof item === 'object' && item !== null))
    : [];

  // Prefer explicit counts from the stream state, and only fall back to the
  // recent comment array length when no top-level count is available.
  const resolvedCommentCount = typeof stateResponse?.commentCount === 'number'
    ? stateResponse.commentCount
    : typeof niconamaState?.meta?.total?.comments === 'number'
      ? niconamaState.meta.total.comments
      : recentComments.length > 0
        ? recentComments.length
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

  const isSpeechSilent = stateResponse?.speech?.silent === true;
  const speechHistoryItems = createSpeechHistoryDisplayItems(stateResponse?.speechHistory);
  const shouldShowRecentComments = options?.showRecentComments !== false;
  if (recentComments.length > 0 && shouldShowRecentComments) {
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
