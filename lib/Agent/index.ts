import { createReceiver } from "../Browser/socket";
import * as Games from "./games";

type GameName = keyof typeof Games;

export class MakaMujo {
  #playing: GameName = 'CookieClicker';
  #solver;
  #state: unknown;

  #talkModel: TalkModel;
  #tts: TTS;

  #speechPromise = Promise.resolve();

  #speechListeners: Array<(text: string) => Promise<void>> = [];

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#tts = tts;
    this.#solver = Games[this.#playing].solver();

    createReceiver((state) => {
      this.#state = state;
      return this.#solver.next(state).value;
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
