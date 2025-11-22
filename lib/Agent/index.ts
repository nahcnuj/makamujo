import { setInterval } from "node:timers/promises";
import * as Games from "./games";

type GameName = keyof typeof Games;

export class MakaMujo {
  #playing: GameName = 'CookieClicker';

  #talkModel: TalkModel;

  #speechPromise = Promise.resolve();

  #speechListeners: Array<(text: string) => Promise<void>> = [];

  constructor(talkModel: TalkModel) {
    this.#talkModel = talkModel;

    this.#loop();
  }

  async speech(text: string = this.#talkModel.generate()) {
    this.#speechPromise = this.#speechPromise.then(async () => {
      await Promise.all(this.#speechListeners.map(f => f(text)));
    }).catch(() => Promise.resolve());
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
        // console.debug('[DEBUG]', '#loop', new Date().toISOString());
        try {
          running = true;
        } catch (err) {
          console.warn('[WARN]', JSON.stringify(err, null, 2));
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
