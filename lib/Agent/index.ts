import { setInterval } from "node:timers/promises";
import * as Games from "./games";
import type { TalkModel } from "./TalkModel";

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

  async speech(text: string = this.#talkModel.generate()): Promise<void> {
    this.#speechPromise = this.#speechPromise.then(async () => {
      await Promise.all(this.#speechListeners.map(f => f(text)));
    });
    await this.#speechPromise;
  }

  onSpeech(cb: (text: string) => Promise<void>) {
    this.#speechListeners.push(cb);
  }

  async #loop(msPerTick: number = 100): Promise<void> {
    let running = false;
    for await (const _ of setInterval(msPerTick)) {
      if (!running) {
        console.debug('[DEBUG]', '#loop', new Date().toISOString());
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