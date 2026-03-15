import { describe, expect, it } from "bun:test";
import { MakaMujo, type TalkModel, type TTS } from ".";

const stubTalkModel: TalkModel = {
  generate: () => '',
  learn: () => {},
  toJSON: () => '{}',
};

const stubTts: TTS = {
  speech: async () => {},
};

describe('speechable', () => {
  it('should be true when no stream state is set', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    expect(agent.speechable).toBeTrue();
  });

  it('should be true when stream is live with listeners', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir({
      type: 'niconama',
      data: {
        title: 'test',
        isLive: true,
        startTime: 0,
        total: 10,
        points: { gift: 0, ad: 0 },
        url: 'https://example.com',
      },
    });
    expect(agent.speechable).toBeTrue();
  });

  it('should be false when stream is live with no listeners', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir({
      type: 'niconama',
      data: {
        title: 'test',
        isLive: true,
        startTime: 0,
        total: 0,
        points: { gift: 0, ad: 0 },
        url: 'https://example.com',
      },
    });
    expect(agent.speechable).toBeFalse();
  });

  it('should be true again after listeners return', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir({
      type: 'niconama',
      data: {
        title: 'test',
        isLive: true,
        startTime: 0,
        total: 0,
        points: { gift: 0, ad: 0 },
        url: 'https://example.com',
      },
    });
    expect(agent.speechable).toBeFalse();

    agent.onAir({
      type: 'niconama',
      data: {
        title: 'test',
        isLive: true,
        startTime: 0,
        total: 1,
        points: { gift: 0, ad: 0 },
        url: 'https://example.com',
      },
    });
    expect(agent.speechable).toBeTrue();
  });

  it('should be true when stream is not live (niconama state cleared)', () => {
    const agent = new MakaMujo(stubTalkModel, stubTts);
    agent.onAir({
      type: 'niconama',
      data: {
        title: 'test',
        isLive: false,
        startTime: 0,
        total: 0,
        points: { gift: 0, ad: 0 },
        url: 'https://example.com',
      },
    });
    expect(agent.speechable).toBeTrue();
  });
});
