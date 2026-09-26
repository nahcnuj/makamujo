import type { State } from "automated-gameplay-transmitter";
import type { GameName } from "../Agent/games/server";
import type { AgentState } from "../Agent/State";
import {
  initialNGramSize,
  initialNGramSizeRaw,
} from "../domain/broadcasting/NGramPolicy";
import type { ProgramCounters } from "./ProgramInfoAssembler";
import type { StreamBaseline } from "./streamBaselineStore";

export type PlayingGame = {
  name: GameName;
  /** Opaque sight state from the active game solver. */
  state: Record<string, unknown>;
};

/**
 * Single mutable aggregate for live-agent runtime fields.
 * Application services share one instance; no concurrent writers (single event loop).
 */
export class AgentSession {
  browserState?: State;
  playing?: PlayingGame;
  streamState?: AgentState;

  lastListenerCount?: number;
  listenersStaleSince?: Date;
  lastCommentAt?: Date;

  /** Active program URL (scopes comment tracking). */
  currentProgramUrl?: string;
  /** Last observed comment number for current program (not monotonic). */
  currentProgramLatestCommentNo = 0;

  /**
   * 視聴済みのニコニコ広告システムコメント件数（番組単位）。
   * 配信ページには件数が出ないので、ページ上で視聴者が見るシステムコメントを数える。
   */
  currentProgramAdCount = 0;
  /** 視聴済みのギフトコメント件数（番組単位）。 */
  currentProgramGiftCount = 0;

  /** Final comment count of the previous stream (for broadcast voltage). */
  previousStreamCommentCount = 0;

  currentNGramSize = initialNGramSize();
  currentNGramSizeRaw = initialNGramSizeRaw();
  hasPromptedCommentForViewerIncrease = false;

  toStreamBaseline(): StreamBaseline {
    return {
      previousStreamCommentCount: this.previousStreamCommentCount,
      currentProgramUrl: this.currentProgramUrl,
      currentProgramLatestCommentNo: this.currentProgramLatestCommentNo,
    };
  }

  restoreStreamBaseline(baseline: StreamBaseline): void {
    this.previousStreamCommentCount = baseline.previousStreamCommentCount;
    this.currentProgramUrl = baseline.currentProgramUrl;
    this.currentProgramLatestCommentNo = baseline.currentProgramLatestCommentNo;
  }

  /** 番組が変わった（または配信終了）ときに広告・ギフトの件数だけ 0 に戻す。 */
  resetProgramCounters(): void {
    this.currentProgramAdCount = 0;
    this.currentProgramGiftCount = 0;
  }

  get programCounters(): ProgramCounters {
    return {
      ad: this.currentProgramAdCount,
      gift: this.currentProgramGiftCount,
    };
  }
}
