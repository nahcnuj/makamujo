import { setInterval } from "node:timers/promises";
import { createReceiver } from "../socket";
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

    this.#loop();

    createReceiver((state) => {
      console.log('[DEBUG]', 'receiver got', state);
      this.#state = state;
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

  async #loop(msPerTick: number = 100) {
    let running = false;
    for await (const _ of setInterval(msPerTick)) {
      if (!running) {
        try {
          running = true;

          // await this.speech();
        } catch (err) {
          console.error(err);
        } finally {
          running = false;
        }
      }
    }
  }
}

export interface TalkModel {
  generate(): string
}

export interface TTS {
  speech(text: string): void
}
