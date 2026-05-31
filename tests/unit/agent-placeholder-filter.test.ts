import { describe, expect, it, jest, beforeEach } from 'bun:test';
import { MakaMujo, type TalkModel, type TTS } from '../../lib/Agent';

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

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('placeholder comment filtering', () => {
  it('ignores placeholder comments like (コメントあり) and only reacts to real comments', async () => {
    const called = jest.fn(async () => {});
    const spyTts: TTS = { speech: called };
    const talkModel: TalkModel = {
      generate: jest.fn((start) => (start === 'こんにちは' ? 'こんにちは、ようこそ。' : '')),
      learn: () => {},
      toJSON: () => '{}',
    };

    const agent = new MakaMujo(talkModel, spyTts);
    agent.onAir(niconamaLive(10));

    // First a placeholder comment (no number)
    agent.listen([{ data: { comment: '(コメントあり)', anonymity: false, hasGift: false } } as any]);
    // Then a real user comment
    agent.listen([{ data: { comment: 'こんにちは', no: 1, anonymity: false, hasGift: false } } as any]);

    // Allow microtasks to run so speech is scheduled
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(called).toHaveBeenCalledTimes(1);
    expect(talkModel.generate as jest.Mock).toHaveBeenCalledWith('こんにちは');
  });
});
