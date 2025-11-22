import { setInterval } from "node:timers/promises";
import { createReceiver } from "../Browser/socket";
import * as Games from "./games";

type GameName = keyof typeof Games;

export class MakaMujo {
  #playing: GameName = 'CookieClicker';
  #state: unknown;

  #talkModel: TalkModel;
  #tts: TTS;

  #speechPromise = Promise.resolve();

  #speechListeners: Array<(text: string) => Promise<void>> = [];

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#tts = tts;

    createReceiver((state) => {
      console.log('[DEBUG]', 'receiver got', state);
      this.#state = state;
      switch (state.name) {
        case 'initialized': {
          return {
            name: 'open',
            url: Games[this.#playing].url,
          };
        }
        case 'idle': {
          return Games[this.#playing].solve(state);
        }
        case 'closed': {
          console.log('[INFO]', 'browser closed');
          return {
            name: 'noop',
          };
        }
      }
    });
  }

  async speech(text: string = this.#talkModel.generate()) {
    console.debug('[DEBUG]', 'speech', text);

    this.#speechPromise = this.#speechPromise.then(async () => {
      await Promise.all(this.#speechListeners.map(f => f(text)));
    }).catch(() => Promise.resolve());

    this.#tts.speech(text);

    await this.#speechPromise;
  }

  onSpeech(cb: (text: string) => Promise<void>): MakaMujo {
    this.#speechListeners.push(cb);
    return this;
  }
}

export interface TalkModel {
  generate(): string
}

export interface TTS {
  speech(text: string): void
}
