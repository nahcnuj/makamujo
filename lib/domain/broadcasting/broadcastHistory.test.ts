import { describe, expect, it } from "bun:test";
import { findLatestProgramEndAt } from "./broadcastHistory";

/** 応答に含まれる番組 1 件を作る。時刻は epoch 秒で受ける。 */
const program = (options: {
  beginSeconds: number;
  endSeconds?: number;
  scheduledEndSeconds?: number;
}) => ({
  id: { value: `lv${options.beginSeconds}` },
  program: {
    schedule: {
      status: "RELEASED",
      beginTime: { seconds: options.beginSeconds, nanos: 0 },
      ...(options.endSeconds === undefined
        ? {}
        : { endTime: { seconds: options.endSeconds, nanos: 0 } }),
      ...(options.scheduledEndSeconds === undefined
        ? {}
        : {
            scheduledEndTime: {
              seconds: options.scheduledEndSeconds,
              nanos: 0,
            },
          }),
    },
  },
});

/** 番組一覧を新しい順に並べた応答を作る。 */
const response = (programs: unknown[]) => ({
  meta: { status: 200 },
  data: { programsList: programs, hasNext: false, totalCount: programs.length },
});

describe("findLatestProgramEndAt", () => {
  it("reads the end time of the newest program", () => {
    const endAt = findLatestProgramEndAt(
      response([
        program({ beginSeconds: 1_791_817_200, endSeconds: 1_791_860_400 }),
        program({ beginSeconds: 1_791_774_000, endSeconds: 1_791_817_200 }),
      ]),
    );

    expect(endAt?.getTime()).toBe(1_791_860_400_000);
  });

  it("falls back to the scheduled end time", () => {
    const endAt = findLatestProgramEndAt(
      response([
        program({
          beginSeconds: 1_791_817_200,
          scheduledEndSeconds: 1_791_860_400,
        }),
      ]),
    );

    expect(endAt?.getTime()).toBe(1_791_860_400_000);
  });

  it("skips programs without a readable end time", () => {
    const endAt = findLatestProgramEndAt(
      response([
        program({ beginSeconds: 1_791_860_400 }),
        program({ beginSeconds: 1_791_817_200, endSeconds: 1_791_860_400 }),
      ]),
    );

    expect(endAt?.getTime()).toBe(1_791_860_400_000);
  });

  it("returns undefined when there is nothing to read", () => {
    expect(findLatestProgramEndAt(response([]))).toBeUndefined();
    expect(findLatestProgramEndAt({})).toBeUndefined();
    expect(findLatestProgramEndAt({ data: {} })).toBeUndefined();
    expect(
      findLatestProgramEndAt({ data: { programsList: "none" } }),
    ).toBeUndefined();
    expect(
      findLatestProgramEndAt({ data: { programsList: [null, 1] } }),
    ).toBeUndefined();
    expect(findLatestProgramEndAt(null)).toBeUndefined();
    expect(findLatestProgramEndAt(undefined)).toBeUndefined();
  });

  it("rejects non-finite timestamps", () => {
    const broken = {
      data: {
        programsList: [
          { program: { schedule: { endTime: { seconds: null } } } },
        ],
      },
    };

    expect(findLatestProgramEndAt(broken)).toBeUndefined();
  });
});
