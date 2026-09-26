import { afterEach, describe, expect, jest, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentComment } from "automated-gameplay-transmitter";
import {
  type RecordedComment,
  sanitizeProgramKey,
} from "../domain/comments/CommentRecorder";
import {
  CRUISE_QUOTE_START_COMMENT,
  CRUISE_WELCOME_SPEECHES,
  STREAM_END_ONE_MINUTE_COMMENT,
  STREAM_END_SPEECHES,
} from "../domain/comments/SystemSpeechScripts";
import { AgentSession } from "./AgentSession";
import { CommentApplicationService } from "./CommentApplicationService";

const programUrl = "https://live.example/watch/lv-app-svc-test";
const jsonlPath = join(
  "var",
  "comments",
  `${sanitizeProgramKey(programUrl)}.jsonl`,
);

afterEach(() => {
  if (existsSync(jsonlPath)) {
    rmSync(jsonlPath, { force: true });
  }
});

function createService(session = new AgentSession()) {
  const talkModel = {
    generate: () => "generated",
    learn: () => {},
    unlearn: () => {},
  };
  const speech = {
    speech: jest.fn(async () => {}),
  };
  return {
    session,
    talkModel,
    speech,
    service: new CommentApplicationService(session, talkModel, speech),
  };
}

function comment(data: Record<string, unknown>): AgentComment {
  return { data } as AgentComment;
}

async function flushRecord(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("CommentApplicationService comment recording", () => {
  test("writes JSONL when currentProgramUrl is set", async () => {
    const { session, service } = createService();
    session.currentProgramUrl = programUrl;

    service.listen([
      comment({
        comment: "  匿名です  ",
        no: 7,
        anonymity: true,
        name: "ignored",
        hasGift: false,
      }),
    ]);
    await flushRecord();

    expect(existsSync(jsonlPath)).toBe(true);
    const entry = JSON.parse(
      readFileSync(jsonlPath, "utf8").trim(),
    ) as RecordedComment;
    expect(entry.who).toBe("anonymous");
    expect(entry.comment).toBe("匿名です");
    expect(entry.no).toBe(7);
    expect(typeof entry.at).toBe("string");
  });

  test("does not write when currentProgramUrl is missing", async () => {
    const { service } = createService();

    service.listen([
      comment({
        comment: "no program",
        no: 1,
        anonymity: false,
        hasGift: false,
      }),
    ]);
    await flushRecord();

    expect(existsSync(jsonlPath)).toBe(false);
  });

  test("does not write system comments", async () => {
    const { session, service } = createService();
    session.currentProgramUrl = programUrl;

    service.listen([
      comment({
        comment: "system",
        anonymity: false,
        name: "生放送クルーズ",
        userId: "onecomme.system",
        hasGift: false,
      }),
    ]);
    await flushRecord();

    expect(existsSync(jsonlPath)).toBe(false);
  });

  test("records named user under display name", async () => {
    const { session, service } = createService();
    session.currentProgramUrl = programUrl;

    service.listen([
      comment({
        comment: "こんにちは",
        no: 2,
        anonymity: false,
        name: "太郎",
        userId: "uid-1",
        hasGift: false,
      }),
    ]);
    await flushRecord();

    const entry = JSON.parse(
      readFileSync(jsonlPath, "utf8").trim(),
    ) as RecordedComment;
    expect(entry.who).toBe("太郎");
    expect(entry.comment).toBe("こんにちは");
  });
});

describe("CommentApplicationService system speech paths", () => {
  test("speaks cruise welcome on cruise quote start", async () => {
    const { speech, service } = createService();

    service.listen([
      comment({
        comment: CRUISE_QUOTE_START_COMMENT,
        userId: "onecomme.system",
        name: "system",
        anonymity: false,
        hasGift: false,
      }),
    ]);
    await flushRecord();

    expect(speech.speech).toHaveBeenCalledTimes(CRUISE_WELCOME_SPEECHES.length);
    for (const text of CRUISE_WELCOME_SPEECHES) {
      expect(speech.speech).toHaveBeenCalledWith(text);
    }
  });

  test("speaks ad thanks with extracted name", async () => {
    const { speech, service } = createService();
    const adComment = "【広告】スポンサーAさんが広告しました";

    service.listen([
      comment({
        comment: adComment,
        userId: "onecomme.system",
        anonymity: false,
        hasGift: false,
      }),
    ]);
    await flushRecord();

    expect(speech.speech).toHaveBeenCalledWith(
      "スポンサーAさん、広告ありがとうございます！",
    );
  });

  test("speaks stream end speeches one minute before end", async () => {
    const { speech, service } = createService();

    service.listen([
      comment({
        comment: STREAM_END_ONE_MINUTE_COMMENT,
        userId: "onecomme.system",
        anonymity: false,
        hasGift: false,
      }),
    ]);
    await flushRecord();

    expect(speech.speech).toHaveBeenCalledTimes(STREAM_END_SPEECHES.length);
    for (const text of STREAM_END_SPEECHES) {
      expect(speech.speech).toHaveBeenCalledWith(text);
    }
  });

  test("speaks gift thanks for named and anonymous gifts", async () => {
    const { speech, service } = createService();

    service.listen([
      comment({
        comment: "gift",
        no: 10,
        anonymity: false,
        hasGift: true,
        origin: {
          message: { gift: { advertiserName: "ギフト主" } },
        },
      }),
      comment({
        comment: "anon gift",
        no: 11,
        anonymity: true,
        hasGift: true,
        origin: {
          message: { gift: { advertiserName: "ignored" } },
        },
      }),
    ]);
    await flushRecord();

    expect(speech.speech).toHaveBeenCalledWith(
      "ギフト主さん、ギフトありがとうございます！",
    );
    expect(speech.speech).toHaveBeenCalledWith("ギフトありがとうございます！");
  });
});
describe("AgentSession defaults", () => {
  test("initializes comment tracking and n-gram fields", () => {
    const session = new AgentSession();

    expect(session.currentProgramUrl).toBeUndefined();
    expect(session.currentProgramLatestCommentNo).toBe(0);
    expect(session.hasPromptedCommentForViewerIncrease).toBe(false);
    expect(typeof session.currentNGramSize).toBe("number");
    expect(typeof session.currentNGramSizeRaw).toBe("number");
    expect(session.lastCommentAt).toBeUndefined();
    expect(session.streamState).toBeUndefined();
  });
});
