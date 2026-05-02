import { beforeEach, describe, expect, it, jest, mock } from "bun:test";
import { MakaMujo, SILENCE_THRESHOLD_MS, type TalkModel, type TTS } from ".";

// Variables starting with "mock" are available in mock.module factory closures
// even after hoisting (following the same convention as jest.mock).
let mockCapturedIpcCallback: ((state: any) => any) | undefined;
const mockSolverControl = { done: false };

mock.module('../Browser/socket', () => ({
  createReceiver: (cb: (state: any) => any) => {
    mockCapturedIpcCallback = cb;
  },
}));

mock.module('./games/server', () => ({
  ServerGames: {
    CookieClicker: {
      solver: () => ({
        next: () =>
          mockSolverControl.done
            ? { done: true as const, value: undefined }
            : { done: false as const, value: { name: 'noop' } },
      }),
      sight: () => ({}),
      Component: () => null,
    },
  },
}));

const stubTalkModel: TalkModel = {
  generate: () => '',
  learn: () => {},
  toJSON: () => '{}',
};

const stubTts: TTS = {
  speech: async () => {},
};

const niconamaLive = (total: number) => ({
  type: 'niconama' as const,
  data: {
    title: 'test',
    isLive: true,
    startTime: 0,
    total,
    points: { gift: 0, ad: 0 },
    url: 'https://example.com',
  },
});

const niconamaOffline = {
  type: 'niconama' as const,
  data: {
    title: 'test',
    isLive: false,
    startTime: 0,
    total: 0,
    points: { gift: 0, ad: 0 },
    url: 'https://example.com',
  },
};

const viewerComment = {
  data: {
    comment: 'こんにちは',
    no: 1,
    anonymity: false,
    hasGift: false,
  },
};

describe('per-program comment counting', () => {
  it('initializes comments to 0 and increments for user comments', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));

    expect(agent.streamState?.meta?.total?.comments ?? 0).toBe(0);

    agent.listen([viewerComment]);
    expect(agent.streamState?.meta?.total?.comments ?? 0).toBe(1);
  });

  it('does not count system messages as user comments', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));

    agent.listen([{ data: { comment: 'system', anonymity: false, hasGift: false, userId: 'onecomme.system' } } as any]);
    expect(agent.streamState?.meta?.total?.comments ?? 0).toBe(0);
  });

  it('resets comment count when the stream URL changes', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);
    expect(agent.streamState?.meta?.total?.comments ?? 0).toBe(1);

    // Simulate a new stream with a different URL
    agent.onAir({ type: 'niconama', data: { title: 'test2', isLive: true, startTime: 0, total: 5, points: { gift: 0, ad: 0 }, url: 'https://example.com/other' } });
    expect(agent.streamState?.meta?.total?.comments ?? 0).toBe(0);
  });
});

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('speechable', () => {
  it('should be true when no stream state is set', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    expect(agent.speechable).toBeTrue();
  });

  it('should be true when stream is offline', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaOffline);
    expect(agent.speechable).toBeTrue();
  });

  it('should be true when stream is live and listener count just changed', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));

    // listener count just changed, so not stale yet
    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS - 1);
    expect(agent.speechable).toBeTrue();
  });

  it('should be false when listener count is stale and no comments have ever been received', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));

    // listener count is stale and no comment ever received → both stale → false
    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();
  });

  it('should be true when listener count is stale but a comment was just received', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    agent.listen([viewerComment]);

    // listener stale but comment just received
    expect(agent.speechable).toBeTrue();
  });

  it('should remain silent when a comment was received long ago and listener count just changed', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    // listener count just changed — resets listenersStaleSince
    agent.onAir(niconamaLive(10));

    expect(agent.speechable).toBeFalse();
  });

  it('should be false when both listener count and last comment are stale', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    // advance past silence threshold
    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();
  });

  it('should be true again after a new comment arrives following silence', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    // new comment arrives
    agent.listen([viewerComment]);
    expect(agent.speechable).toBeTrue();
  });

  it('prompts once on viewer increase during silence but remains silent', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const called = jest.fn(async () => {});
    const spyTts: TTS = { speech: called };
    const agent = new MakaMujo(stubTalkModel, spyTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    // viewer count changes — should prompt once but remain speechable=false
    agent.onAir(niconamaLive(11));
    // allow the speech task to be scheduled and run
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.speechable).toBeFalse();
    expect(called).toHaveBeenCalledTimes(1);
  });

  it('resets prompted flag when direct TTS playback fails and allows speechable', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const fail = jest.fn(async () => { throw new Error('boom'); });
    const failTts: TTS = { speech: fail };
    const agent = new MakaMujo(stubTalkModel, failTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    // viewer count changes — prompt attempted; wait for the speech task
    agent.onAir(niconamaLive(11));
    // allow microtasks/macrotasks to run so the speech task and rejection handler execute
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fail).toHaveBeenCalledTimes(1);
    // after failed playback the prompt flag should be cleared and speechable true
    expect(agent.speechable).toBeTrue();
  });

  it('prompts immediately even when main speech is blocked', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const called = jest.fn(async (text: string) => {
      if (text === 'main-block') {
        return new Promise<void>(() => {});
      }
      return;
    });
    const spyTts: TTS = { speech: called as any };
    const agent = new MakaMujo(stubTalkModel, spyTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    // Start a long-running main speech without awaiting it
    agent.speech('main-block');
    // viewer count changes — prompt should be queued (not played) while main speech is pending
    agent.onAir(niconamaLive(11));
    // allow scheduled tasks to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(called).toHaveBeenCalledWith('main-block', { additionalHalfTone: 3, speakingRate: 1.2 });
    expect(called).not.toHaveBeenCalledWith('コメントしていってね〜', { additionalHalfTone: 3, speakingRate: 1.2 });
    expect(agent.speechable).toBeFalse();
  });

  it('clears prompt-flag if prompt playback fails while main speech blocked', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const fail = jest.fn(async (text: string) => {
      if (text === 'main-block') {
        return new Promise<void>(() => {});
      }
      if (text === 'コメントしていってね〜') {
        return Promise.reject(new Error('boom'));
      }
      return;
    });
    const failTts: TTS = { speech: fail as any };
    const agent = new MakaMujo(stubTalkModel, failTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    agent.speech('main-block');
    agent.onAir(niconamaLive(11));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // With queued behavior the prompt is not played while main speech is pending.
    expect(fail).not.toHaveBeenCalledWith('コメントしていってね〜');
    expect(agent.speechable).toBeFalse();
  });

  it('should be true again after stream goes offline following silence', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    agent.onAir(niconamaOffline);
    expect(agent.speechable).toBeTrue();
  });
});

describe('speech completion hooks', () => {
  it('calls onSpeechComplete after speech playback finishes', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const speechListener = jest.fn(async () => {});
    const completeListener = jest.fn(async () => {});

    agent.onSpeech(speechListener);
    agent.onSpeechComplete(completeListener);

    await agent.speech('hello');

    expect(speechListener).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      generated: false,
    }));
    expect(completeListener).toHaveBeenCalled();
  });

  it('emits generated=true when speech is produced by the default argument', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const speechListener = jest.fn(async () => {});

    agent.onSpeech(speechListener);
    await agent.speech();

    expect(speechListener).toHaveBeenCalledWith(expect.objectContaining({
      generated: true,
      nGram: 1,
      nGramRaw: -2,
    }));
  });
});

describe('comment learning n-gram size', () => {
  const comment = (no: number) => ({
    data: {
      comment: 'こんにちは',
      no,
      anonymity: false,
      hasGift: false,
    },
  });

  it.each([
    { no: 1, expected: 1 },
    { no: 10, expected: 1 },
    { no: 99, expected: 1 },
    { no: 100, expected: 2 },
    { no: 999, expected: 3 },
    { no: 1_000, expected: 4 },
    { no: 5_000, expected: 5 },
    { no: 9_999, expected: 5 },
    { no: 10_000, expected: 6 },
  ])('generates with n=$expected for comment no=$no', ({ no, expected }) => {
    const generate = jest.fn(() => '');
    const learn = jest.fn();
    const talkModel: TalkModel = {
      generate,
      learn,
      toJSON: () => '{}',
    };
    const agent = new MakaMujo(talkModel, stubTts);

    agent.listen([comment(no)]);

    expect(learn).toHaveBeenCalledWith('こんにちは。');
    expect(generate).toHaveBeenCalledWith('こんにちは', expected);
  });

  it('uses latest inferred n when generating default speech', async () => {
    const generate = jest.fn(() => '');
    const talkModel: TalkModel = {
      generate,
      learn: () => {},
      toJSON: () => '{}',
    };
    const agent = new MakaMujo(talkModel, stubTts);

    agent.listen([comment(1_000)]);
    await agent.speech();

    expect(generate).toHaveBeenLastCalledWith('', 4);
  });

  it('initializes currentNGramSizeRaw from initial comment number', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    expect(agent.currentNGramSizeRaw).toBe(-2);
  });

  it('updates currentNGramSizeRaw from comment number before flooring', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.listen([comment(5_000)]);
    expect(agent.currentNGramSizeRaw).toBeCloseTo(5.3979400086720375);
  });

  it('does not update n-gram raw state when no is 0', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const initialRaw = agent.currentNGramSizeRaw;

    agent.listen([comment(0)]);

    expect(agent.currentNGramSizeRaw).toBe(initialRaw);
  });

  it('does not learn comment when no is 0', () => {
    const generate = jest.fn(() => '');
    const learn = jest.fn();
    const talkModel: TalkModel = {
      generate,
      learn,
      toJSON: () => '{}',
    };
    const agent = new MakaMujo(talkModel, stubTts);

    agent.listen([comment(0)]);

    expect(learn).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('onGameStateChange', () => {
  beforeEach(() => {
    mockCapturedIpcCallback = undefined;
    mockSolverControl.done = false;
  });

  const flushMicrotasks = () => Promise.resolve();

  it('calls listener when IPC receives closed state', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const listener = jest.fn();
    agent.onGameStateChange(listener);

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'closed' });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('calls listener when IPC receives idle state with game state payload', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const listener = jest.fn();
    agent.onGameStateChange(listener);

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'idle', state: { cookies: 42 } });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not call listener when IPC receives idle state without game state payload', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const listener = jest.fn();
    agent.onGameStateChange(listener);

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'idle' });
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
  });

  it('calls listener when solver signals done', async () => {
    mockSolverControl.done = true;
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const listener = jest.fn();
    agent.onGameStateChange(listener);

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'idle' });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('defers listener execution via queueMicrotask so IPC receiver is not blocked', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const callOrder: string[] = [];
    agent.onGameStateChange(() => { callOrder.push('listener'); });

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'closed' });
    callOrder.push('afterReceiver');

    // Listener must not have run synchronously
    expect(callOrder).toEqual(['afterReceiver']);

    await flushMicrotasks();
    expect(callOrder).toEqual(['afterReceiver', 'listener']);
  });

  it('calls all registered listeners', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const listenerA = jest.fn();
    const listenerB = jest.fn();
    agent.onGameStateChange(listenerA);
    agent.onGameStateChange(listenerB);

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'closed' });
    await flushMicrotasks();

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it('continues calling remaining listeners even if one throws', async () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    const failingListener = jest.fn(() => { throw new Error('boom'); });
    const succeedingListener = jest.fn();
    agent.onGameStateChange(failingListener);
    agent.onGameStateChange(succeedingListener);

    agent.play('CookieClicker');
    mockCapturedIpcCallback!({ name: 'closed' });
    await flushMicrotasks();

    expect(failingListener).toHaveBeenCalledTimes(1);
    expect(succeedingListener).toHaveBeenCalledTimes(1);
  });
});
