import type { State } from "automated-gameplay-transmitter";
import type { GameName } from "../Agent/games/server";
import type { AgentState } from "../Agent/State";
import {
  initialNGramSize,
  initialNGramSizeRaw,
} from "../domain/broadcasting/NGramPolicy";
import { type StreamBaseline, toDate } from "./streamBaselineStore";

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

  /** Final comment count of the previous stream (for broadcast voltage). */
  previousStreamCommentCount = 0;

  currentNGramSize = initialNGramSize();
  currentNGramSizeRaw = initialNGramSizeRaw();
  hasPromptedCommentForViewerIncrease = false;

  constructor(baseline?: StreamBaseline) {
    if (baseline !== undefined) {
      this.restoreStreamBaseline(baseline);
    }
  }

  /** Construct an empty session (no restored state). */
  static empty(): AgentSession {
    return new AgentSession();
  }

  /** Construct a session restored from a persisted baseline. */
  static fromBaseline(baseline: StreamBaseline): AgentSession {
    return new AgentSession(baseline);
  }

  toStreamBaseline(): StreamBaseline {
    let lastCommentAt: Date | undefined;
    if (
      this.lastCommentAt !== undefined &&
      Number.isFinite(this.lastCommentAt.getTime())
    ) {
      lastCommentAt = new Date(this.lastCommentAt);
    }
    return {
      previousStreamCommentCount: this.previousStreamCommentCount,
      currentProgramUrl: this.currentProgramUrl,
      currentProgramLatestCommentNo: this.currentProgramLatestCommentNo,
      lastCommentAt,
    };
  }

  restoreStreamBaseline(baseline: StreamBaseline): void {
    this.previousStreamCommentCount = baseline.previousStreamCommentCount;
    this.currentProgramUrl = baseline.currentProgramUrl;
    this.currentProgramLatestCommentNo = baseline.currentProgramLatestCommentNo;
    this.lastCommentAt = toDate(baseline.lastCommentAt);
  }
}
