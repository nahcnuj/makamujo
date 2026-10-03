/**
 * Regression coverage for #671: `var/stream-baseline.json` used to persist
 * `previousStreamCommentCount: 0` even though the recording of the program that
 * just ended was sitting right there in `var/comments/`.
 *
 * The scenario is a restart during a heavily commented program: the in-memory
 * `currentProgramLatestCommentNo` never saw those comments, so the only source
 * of truth left is the recorded JSONL.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MakaMujo, type TalkModel, type TTS } from "../../lib/Agent";
import {
  loadStreamBaselineWithRecovery,
  resolvePreviousStreamCommentCount,
  saveStreamBaseline,
} from "../../lib/application/streamBaselineStore";

const ENDED_PROGRAM_URL = "https://live.nicovideo.jp/watch/lv351439452";
const NEW_PROGRAM_URL = "https://live.nicovideo.jp/watch/lv351439453";
const ENDED_PROGRAM_FINAL_COMMENT_NO = 538;

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "stream-baseline-recovery-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const stubTalkModel: TalkModel = {
  generate: () => "",
  learn: () => {},
  unlearn: () => {},
  toJSON: () => "{}",
};

const stubTts: TTS = {
  speech: async () => {},
};

const programFileName = (programUrl: string): string =>
  `${programUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`;

const writeRecordedComments = (
  commentsDir: string,
  programUrl: string,
  commentNos: number[],
): void => {
  const lines = commentNos.map((no) =>
    JSON.stringify({ who: "viewer", comment: "hello", at: "x", no }),
  );
  writeFileSync(
    join(commentsDir, programFileName(programUrl)),
    `${lines.join("\n")}\n`,
    "utf8",
  );
};

const livePayload = (url: string) => ({
  type: "niconama" as const,
  data: {
    title: "test",
    isLive: true,
    startTime: 0,
    total: 10,
    points: { gift: 0, ad: 0 },
    url,
  },
});

/**
 * Build the on-disk layout from the issue report and return the paths plus a
 * MakaMujo wired the same way `index.ts` wires it.
 */
const setUpSession = (
  baselineOnDisk: {
    previousStreamCommentCount: number;
    currentProgramUrl: string;
    currentProgramLatestCommentNo: number;
  },
  recordedCommentNos: Record<string, number[]>,
) => {
  const root = makeTempDir();
  const commentsDir = join(root, "comments");
  mkdirSync(commentsDir, { recursive: true });
  const baselinePath = join(root, "stream-baseline.json");
  for (const [programUrl, commentNos] of Object.entries(recordedCommentNos)) {
    writeRecordedComments(commentsDir, programUrl, commentNos);
  }
  saveStreamBaseline(baselinePath, baselineOnDisk);

  const agent = new MakaMujo(stubTalkModel, stubTts, {
    baseline: loadStreamBaselineWithRecovery(baselinePath, commentsDir),
    onBaselineChange: (baseline) => saveStreamBaseline(baselinePath, baseline),
    resolvePreviousCommentCount: (
      endedProgramUrl,
      inMemoryCount,
      incomingProgramUrl,
    ) =>
      resolvePreviousStreamCommentCount(
        commentsDir,
        endedProgramUrl,
        inMemoryCount,
        incomingProgramUrl,
      ),
  });

  return { agent, baselinePath };
};

const readBaseline = (baselinePath: string) =>
  JSON.parse(readFileSync(baselinePath, "utf8")) as {
    previousStreamCommentCount: number;
    currentProgramUrl?: string;
    currentProgramLatestCommentNo: number;
  };

const heavilyCommentedProgram = () =>
  Array.from({ length: ENDED_PROGRAM_FINAL_COMMENT_NO }, (_, i) => i + 1);

describe("previousStreamCommentCount survives a restart mid-program (#671)", () => {
  it("records the ended program's count when the new program starts", () => {
    // The process restarted while the ended program was running, so the
    // in-memory counter is 0 even though that program was heavily commented.
    const { agent, baselinePath } = setUpSession(
      {
        previousStreamCommentCount: 0,
        currentProgramUrl: ENDED_PROGRAM_URL,
        currentProgramLatestCommentNo: 0,
      },
      { [ENDED_PROGRAM_URL]: heavilyCommentedProgram() },
    );

    agent.onAir(livePayload(ENDED_PROGRAM_URL));
    agent.onAir(livePayload(NEW_PROGRAM_URL));

    expect(readBaseline(baselinePath)).toEqual({
      previousStreamCommentCount: ENDED_PROGRAM_FINAL_COMMENT_NO,
      currentProgramUrl: NEW_PROGRAM_URL,
      currentProgramLatestCommentNo: 0,
    });
  });

  it("recovers the ended program's count from the state in the issue report", () => {
    // Exactly what `var/stream-baseline.json` looked like in #671: the new
    // program is already recorded but the baseline never learned the previous
    // program's count.
    const { agent } = setUpSession(
      {
        previousStreamCommentCount: 0,
        currentProgramUrl: NEW_PROGRAM_URL,
        currentProgramLatestCommentNo: 1,
      },
      {
        [ENDED_PROGRAM_URL]: heavilyCommentedProgram(),
        [NEW_PROGRAM_URL]: [1],
      },
    );

    expect(agent.previousStreamCommentCount).toBe(
      ENDED_PROGRAM_FINAL_COMMENT_NO,
    );
  });

  it("does not regress when the ended program is only known in memory", () => {
    const { agent, baselinePath } = setUpSession(
      {
        previousStreamCommentCount: 0,
        currentProgramUrl: ENDED_PROGRAM_URL,
        currentProgramLatestCommentNo: 0,
      },
      {},
    );

    agent.onAir(livePayload(ENDED_PROGRAM_URL));
    agent.listen([{ data: { comment: "テスト", anonymity: true, no: 42 } }]);
    agent.onAir(livePayload(NEW_PROGRAM_URL));

    expect(readBaseline(baselinePath).previousStreamCommentCount).toBe(42);
  });

  it("keeps the known count when nothing can be resolved", () => {
    const { agent, baselinePath } = setUpSession(
      {
        previousStreamCommentCount: 538,
        currentProgramUrl: ENDED_PROGRAM_URL,
        currentProgramLatestCommentNo: 0,
      },
      {},
    );

    agent.onAir(livePayload(ENDED_PROGRAM_URL));
    agent.onAir(livePayload(NEW_PROGRAM_URL));

    expect(readBaseline(baselinePath).previousStreamCommentCount).toBe(538);
  });
});
