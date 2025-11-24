import { createReceiver, type State } from "../Browser/socket";
import { Games, type GameName } from "./games";
import type { StreamState } from "./states";

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
      await Promise.all(this.#speechListeners.map(f => f(text)));
    }).catch(() => Promise.resolve());

    await new Promise((resolve) => {
      this.#tts.speech(text);
      resolve(null);
    });

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
        // TODO
        this.speech(comment);
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
        const { isLive, title, startTime: start, url, total: listeners, points: { gift, ad } } = state.data;
        this.#streamState[state.type] = isLive ? {
          type: 'live',
          title,
          start,
          url,
          total: {
            listeners,
            gift: typeof gift === 'string' ? Number.parseFloat(gift) : gift,
            ad: typeof ad === 'string' ? Number.parseFloat(ad) : ad,
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
    ].includes(this.#state?.name ?? '');
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
  generate(): string
  learn(text: string): void
}

export interface TTS {
  speech(text: string): void
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
