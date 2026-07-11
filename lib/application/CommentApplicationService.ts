import type { AgentComment } from "automated-gameplay-transmitter";
import {
  inferNGramSize,
  inferNGramSizeRaw,
} from "../domain/broadcasting/NGramPolicy";
import {
  CRUISE_WELCOME_SPEECHES,
  extractAdName,
  formatAdThanks,
  formatGiftThanks,
  isAdCompletedComment,
  isCruiseQuoteStart,
  isStreamEndOneMinute,
  STREAM_END_SPEECHES,
} from "../domain/comments/SystemSpeechScripts";
import { pickTopic } from "../domain/comments/TopicPicker";
import type { AgentSession } from "./AgentSession";
import type { CommentData, SpeechPort, TalkModelPort } from "./types";

/**
 * CommentPipeline steps 1–9 (architecture/domain-model-redesign.md).
 * Mutates the shared AgentSession only from this service for comment-side fields.
 */
export class CommentApplicationService {
  #session: AgentSession;
  #talkModel: TalkModelPort;
  #speech: SpeechPort;

  constructor(
    session: AgentSession,
    talkModel: TalkModelPort,
    speech: SpeechPort,
  ) {
    this.#session = session;
    this.#talkModel = talkModel;
    this.#speech = speech;
  }

  listen(comments: AgentComment[]): void {
    for (const { data } of comments) {
      const commentData = data as CommentData;
      // Step 1 — NFC normalize for learning / topic; system match uses raw where noted
      const comment = commentData.comment.normalize("NFC").trim();
      console.debug("[DEBUG]", "comment", JSON.stringify(data, null, 0));

      // Step 2 — all comments refresh silence clock
      this.#session.lastCommentAt = new Date(Date.now());
      // Step 3
      this.#session.hasPromptedCommentForViewerIncrease = false;

      // Step 4
      if (typeof data.no === "number" && data.no > 0) {
        const commentNumber = data.no;
        this.#session.currentNGramSizeRaw = inferNGramSizeRaw(commentNumber);
        this.#session.currentNGramSize = inferNGramSize(commentNumber);
      }

      // Step 5 — truthy no or owner
      if (data.no || data.isOwner) {
        this.#talkModel.learn(`${comment}。`);
      }

      // Step 6 — user no or cruise name
      if (
        data.no ||
        (data.userId === "onecomme.system" && data.name === "生放送クルーズ")
      ) {
        console.log("[INFO]", `got a comment: "${comment}"`);
        const topic = pickTopic(comment);
        if (topic) {
          if (this.#session.streamState) {
            this.#session.streamState.replyTargetComment = {
              text: comment,
              pickedTopic: topic,
            };
          }
          void this.#speech.speech(
            this.#talkModel.generate(topic, this.#session.currentNGramSize),
          );
        }
      }

      let isAd = false;

      // Step 7 — system scripts (raw comment text for exact matches)
      if (data.userId === "onecomme.system") {
        if (isCruiseQuoteStart(commentData.comment)) {
          console.log("[INFO]", `niconama cruise is coming`);
          for (const text of CRUISE_WELCOME_SPEECHES) {
            void this.#speech.speech(text);
          }
          continue;
        }

        if (isAdCompletedComment(commentData.comment)) {
          isAd = true;
          const name = extractAdName(commentData.comment);

          console.log("[INFO]", `AD ${name}`);
          void this.#speech.speech(formatAdThanks(name));
          continue;
        }

        if (isStreamEndOneMinute(commentData.comment)) {
          console.log("[INFO]", "announce the end of a stream...");
          for (const text of STREAM_END_SPEECHES) {
            void this.#speech.speech(text);
          }
          continue;
        }
      }

      // Step 8 — program comment counter (not monotonic)
      if (
        typeof commentData.no === "number" &&
        commentData.no > 0 &&
        this.#session.currentProgramUrl
      ) {
        this.#session.currentProgramLatestCommentNo = commentData.no;
        if (this.#session.streamState?.meta) {
          const existingTotal = this.#session.streamState.meta.total ?? {
            listeners: 0,
            gift: 0,
            ad: 0,
          };
          this.#session.streamState.meta = {
            ...this.#session.streamState.meta,
            total: {
              ...existingTotal,
              comments: this.#session.currentProgramLatestCommentNo,
            },
          };
        }
      }

      // Step 9 — gift
      if (data.hasGift && !isAd) {
        const name = (
          data as {
            origin?: { message?: { gift?: { advertiserName?: string } } };
          }
        ).origin?.message?.gift?.advertiserName;
        console.log(`[GIFT] ${name}`);
        void this.#speech.speech(
          formatGiftThanks(name, Boolean(data.anonymity)),
        );
      }
    }
  }
}
