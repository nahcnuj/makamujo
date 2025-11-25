import { createReceiver, type State } from "../Browser/socket";
import { Games, type GameName } from "./games";
import type { StreamState } from "./states";

const jaJP = new Intl.Locale('ja-JP');
const pickTopic = (text: string) => {
  const words = Array.from(new Intl.Segmenter(jaJP, { granularity: 'word' }).segment(text)).map(({ segment }) => segment);
  const cands = words.reduce<string[]>((prev, s) => {
    const a = [...s].length;
    const b = [...prev[0] ?? ''].length;
    // console.debug(s, a, b, [s], [...prev, s]);
    return a > b ? [s] : a === b ? [...prev, s] : prev;
  }, ['']);
  const topic = cands.at(Math.floor(Math.random() * cands.length));
  return topic;
};

export class MakaMujo {
  #talkModel: TalkModel;
  #tts: TTS;

  #speechPromise = Promise.resolve();
  #speechListeners: Array<(text: string) => Promise<void>> = [];

  #state?: State;
  #playing?: {
    name: GameName
    state: ReturnType<typeof Games[GameName]['sight']>
  }

  #streamState: {
    niconama?: StreamState
  } = {}

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#tts = tts;
  }

  play(name: GameName, data?: string) {
    const solver = Games[name].solver({
      type: 'initialize',
      data,
    });
    createReceiver((state) => {
      this.#state = state;

      if (state.name === 'closed') {
        this.#playing = undefined;
        return;
      }

      if (state.name === 'idle') {
        console.debug('[DEBUG]', 'receiver idle state =', state);
        if (state.state) {
          this.#playing = {
            name,
            state: {
              ...this.#playing?.state ?? {},
              ...state.state,
            } as any,
          };
        }
      }

      return solver.next(state).value;
    });
  }

  async speech(text: string = this.#talkModel.generate()) {
    console.log('[DEBUG]', 'speech', text);

    this.#speechPromise = this.#speechPromise.then(async () => {
      await Promise.all([
        this.#tts.speech(text),
        ...this.#speechListeners.map(f => f(text)),
      ]);
    }).catch(() => Promise.resolve());

    await this.#speechPromise;
  }

  onSpeech(cb: (text: string) => Promise<void>): MakaMujo {
    this.#speechListeners.push(cb);
    return this;
  }

  listen(comments: Array<{ data: CommentData }>) {
    for (const { data } of comments) {
      const comment = data.comment.normalize('NFC').trim();

      if (data.no || data.isOwner) {
        this.#learn(`${comment}。`);
      }

      if (data.no || (data.userId === 'onecomme.system' && data.name === '生放送クルーズ')) {
        // TODO reply
        const topic = pickTopic(comment);
        if (topic) {
          console.debug('[DEBUG]', 'picked a word', `"${topic}"`, 'from', `"${comment}"`);
          this.speech(this.#talkModel.generate(topic));
        }
      }
    }
  }

  #learn(text: `${string}。`) {
    this.#talkModel.learn(text);
  }

  onAir(state: StreamData) {
    // console.debug('[DEBUG]', state);
    switch (state.type) {
      case 'niconama': {
        const { isLive, title, startTime: start, url, total: listeners, points } = state.data;
        this.#streamState[state.type] = isLive ? {
          type: 'live',
          title,
          start,
          url,
          total: {
            listeners,
            gift: typeof points?.gift === 'string' ? Number.parseFloat(points.gift) : points?.gift,
            ad: typeof points?.ad === 'string' ? Number.parseFloat(points.ad) : points?.ad,
          },
        } : undefined;
        break;
      }
    }
  }

  get speechable() {
    return [
      'idle',
      'result',
      'closed',
    ].includes(this.#state?.name ?? 'idle');
  }

  get playing() {
    return this.#playing;
  }

  get streamState() {
    return this.#streamState;
  }

  get Component() {
    if (this.#playing === undefined) return () => null;
    return Games[this.#playing.name].Component;
  }
}

export interface TalkModel {
  generate(start?: string): string
  learn(text: string): void
}

export interface TTS {
  speech(text: string): Promise<void>
}

type StreamData =
  | {
    type: 'niconama'
    data: {
      title: string
      isLive: boolean
      startTime: number
      total: number
      points: {
        gift: number | string
        ad: number | string
      }
      url: string
    }
  };

type CommentData = {
  comment: string
  no?: number
  isOwner?: boolean
  name?: string
  userId?: string
};
