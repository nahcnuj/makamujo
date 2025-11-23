import { createReceiver, type State } from "../Browser/socket";
import { Games, type GameName } from "./games";

export class MakaMujo {
  #talkModel: TalkModel;
  #tts: TTS;

  #speechPromise = Promise.resolve();
  #speechListeners: Array<(text: string) => Promise<void>> = [];

  #state: State | undefined;

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#tts = tts;
  }

  play(game: GameName, data?: string) {
    const solver = Games[game].solver({
      type: 'initialize',
      data,
    });
    createReceiver((state) => {
      this.#state = state;
      return solver.next(state).value;
    });
  }

  async speech(text: string = this.#talkModel.generate()) {
    console.log('[DEBUG]', 'speech', text);

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

  get speechable() {
    return [
      'idle',
      'result',
      'closed',
    ].includes(this.#state?.name ?? '');
  }
}

export interface TalkModel {
  generate(): string
}

export interface TTS {
  speech(text: string): void
}
