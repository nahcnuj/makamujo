import { describe, expect, it, mock } from "bun:test";
import type { AgentState } from "../../lib/Agent/State";
import {
  setStreamStateFromMetaApiResponse,
  updateSpeechStateFromSpeechApiResponse,
} from "./AgentContext";
import { updateSpeechState } from "./speechState";

describe("updateSpeechState", () => {
  describe("silent", () => {
    it("calls setSilent(false) when response has no silent field", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({}, [], setSpeechLines, setSilent);
      expect(setSilent).toHaveBeenCalledWith(false);
    });

    it("calls setSilent(false) when API returns silent:false", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ silent: false }, [], setSpeechLines, setSilent);
      expect(setSilent).toHaveBeenCalledWith(false);
    });

    it("calls setSilent(true) when API returns silent:true", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ silent: true }, [], setSpeechLines, setSilent);
      expect(setSilent).toHaveBeenCalledWith(true);
    });

    it("calls setSilent(false) after previously being true", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ silent: true }, [], setSpeechLines, setSilent);
      expect(setSilent).toHaveBeenLastCalledWith(true);
      updateSpeechState({ silent: false }, [], setSpeechLines, setSilent);
      expect(setSilent).toHaveBeenLastCalledWith(false);
    });
  });

  describe("speech", () => {
    it("starts a new line list when API returns a non-empty string", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ speech: "hello" }, [], setSpeechLines, setSilent);
      expect(setSpeechLines).toHaveBeenCalledWith(["hello"]);
    });

    it("normalizes speech objects with a text field", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: { text: "こんにちは" } },
        [],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith(["こんにちは"]);
    });

    it("normalizes speech objects with a speech field", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: { speech: "こんばんは" } },
        [],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith(["こんばんは"]);
    });

    it("clears lines when API returns an empty string", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "" },
        ["old text"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith([]);
    });

    it("does not call setSpeechLines when API response has no speech field", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({}, ["old text"], setSpeechLines, setSilent);
      expect(setSpeechLines).not.toHaveBeenCalled();
    });

    it("clears lines when agent is silent", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "", silent: true },
        ["last spoken"],
        setSpeechLines,
        setSilent,
      );
      expect(setSilent).toHaveBeenCalledWith(true);
      expect(setSpeechLines).toHaveBeenCalledWith([]);
    });

    it("appends when previous line does not end with 。", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "に行った。", silent: false },
        ["今日は公園"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith(["今日は公園", "に行った。"]);
      expect(setSilent).toHaveBeenCalledWith(false);
    });

    it("keeps only the last 2 lines on continuation", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "三行目" },
        ["一行目", "二行目"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith(["二行目", "三行目"]);
    });

    it("replaces when previous line ends with 。", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "次の話題です。" },
        ["昨日の話。"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith(["次の話題です。"]);
    });

    it("replaces on ありがとうございます！ interrupt", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "太郎さん、広告ありがとうございます！" },
        ["今日は公園"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith([
        "太郎さん、広告ありがとうございます！",
      ]);
    });

    it("replaces after ありがとうございます！ as topic end", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "次の話題" },
        ["太郎さん、広告ありがとうございます！"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).toHaveBeenCalledWith(["次の話題"]);
    });

    it("does not update when speech text is unchanged", () => {
      const setSpeechLines = mock((_: string[]) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState(
        { speech: "同じ" },
        ["同じ"],
        setSpeechLines,
        setSilent,
      );
      expect(setSpeechLines).not.toHaveBeenCalled();
    });
  });
});

describe("updateSpeechStateFromSpeechApiResponse", () => {
  it("does not update state when res is null (fetch error)", () => {
    const setSpeechLines = mock((_: string[]) => {});
    const setSilent = mock((_: boolean) => {});
    updateSpeechStateFromSpeechApiResponse(
      null,
      ["currently displayed text"],
      setSpeechLines,
      setSilent,
    );
    expect(setSpeechLines).not.toHaveBeenCalled();
    expect(setSilent).not.toHaveBeenCalled();
  });

  it("updates speech state when res is a valid response", () => {
    const setSpeechLines = mock((_: string[]) => {});
    const setSilent = mock((_: boolean) => {});
    updateSpeechStateFromSpeechApiResponse(
      { speech: "new speech", silent: false },
      [],
      setSpeechLines,
      setSilent,
    );
    expect(setSpeechLines).toHaveBeenCalledWith(["new speech"]);
    expect(setSilent).toHaveBeenCalledWith(false);
  });
});

describe("setStreamStateFromMetaApiResponse", () => {
  it("does not update state when res is null (fetch error)", () => {
    const setStreamState = mock((_: AgentState | undefined) => {});
    setStreamStateFromMetaApiResponse(null, setStreamState);
    expect(setStreamState).not.toHaveBeenCalled();
  });

  it("updates stream state when res contains niconama", () => {
    const setStreamState = mock((_: AgentState | undefined) => {});
    const niconama: AgentState = {
      type: "live",
      meta: { title: "test", url: "https://example.com", start: 0 },
    };
    setStreamStateFromMetaApiResponse({ niconama }, setStreamState);
    expect(setStreamState).toHaveBeenCalledWith(niconama);
  });

  it("updates stream state to undefined when niconama is absent in res", () => {
    const setStreamState = mock((_: AgentState | undefined) => {});
    setStreamStateFromMetaApiResponse({}, setStreamState);
    expect(setStreamState).toHaveBeenCalledWith(undefined);
  });
});
