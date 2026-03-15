import { beforeEach, describe, expect, it, jest } from "bun:test";
import { MakaMujo, SILENCE_THRESHOLD_MS, type TalkModel, type TTS } from ".";

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

  it('should be true when a comment was received long ago but listener count just changed', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    // listener count just changed — resets listenersStaleSince
    agent.onAir(niconamaLive(10));

    expect(agent.speechable).toBeTrue();
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

  it('should be true again after listener count changes following silence', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir(niconamaLive(10));
    agent.listen([viewerComment]);

    jest.spyOn(Date, 'now').mockReturnValue(SILENCE_THRESHOLD_MS);
    expect(agent.speechable).toBeFalse();

    // viewer count changes
    agent.onAir(niconamaLive(11));
    expect(agent.speechable).toBeTrue();
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
