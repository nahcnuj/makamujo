import { Action, type State } from "automated-gameplay-transmitter";
import { createReceiver } from "../Browser/socket";
import { Games, type GameName } from "./games";
import type { StreamState } from "./states";
import { writeFileSync } from "node:fs";

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

  #browserState?: State;
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
    }, {
      onSave: [
        (text) => writeFileSync('./var/cookieclicker.txt', text),
      ],
    });
    createReceiver((state) => {
      this.#browserState = state;

      if (state.name === 'closed') {
        this.#playing = undefined;
        return Action.noop;
      }

      if (state.name === 'idle') {
        // console.debug('[DEBUG]', 'receiver idle state =', JSON.stringify(state.state, null, 0));
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

      const { done, value } = solver.next(state);
      if (done) {
        this.#playing = undefined;
        return Action.noop;
      }
      console.debug('[DEBUG]', 'next action', JSON.stringify(value, null, 0));

      return value;
    });
  }

  async speech(text: string = this.#talkModel.generate()) {
    // console.log('[DEBUG]', 'speech', text);

    this.#speechPromise = this.#speechPromise.then(async () => {
      await Promise.all([
        this.#tts.speech(text, { additionalHalfTone: 3, speakingRate: 1.2 }),
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
      console.debug('[DEBUG]', 'comment', JSON.stringify(data, null, 0));

      if (data.no || data.isOwner) {
        this.#learn(`${comment}。`);
      }

      if (data.no || (data.userId === 'onecomme.system' && data.name === '生放送クルーズ')) {
        console.log('[INFO]', `got a comment: "${comment}"`);
        // TODO reply
        const topic = pickTopic(comment);
        if (topic) {
          // console.debug('[DEBUG]', 'picked a word', `"${topic}"`, 'from', `"${comment}"`);
          this.speech(this.#talkModel.generate(topic));
        }
      }

      let isAd = false; // FIXME

      if (data.userId === 'onecomme.system') {
        if (data.comment === '「生放送クルーズさん」が引用を開始しました') {
          console.log('[INFO]', `niconama cruise is coming`);
          for (const text of [
            '生放送クルーズのみなさん、こんにちは',
            'AI Vチューバーの馬可無序です',
            'コメントを学習してお話ししています',
            'ぜひ上のリンクから遊びに来てね',
          ]) {
            this.speech(text);
          }
          continue;
        }

        if (data.comment.endsWith('広告しました')) {
          isAd = true;
          const name = data.comment.slice(data.comment.indexOf('】') + '】'.length, data.comment.lastIndexOf('さんが'));

          console.log('[INFO]', `AD ${name}`);
          this.speech(`${name}さん、広告ありがとうございます！`);
          continue;
        }

        if (data.comment === '配信終了1分前です') {
          console.log('[INFO]', 'announce the end of a stream...');
          for (const text of [
            'そろそろお別れのお時間です',
            'ご視聴、コメント、広告、ギフト、皆様ありがとうございました！',
            'AI Vチューバーの馬可無序がお送りしました',
            '次回の配信もお楽しみに！',
          ]) {
            this.speech(text);
          }
          continue;
        }
      }

      if (data.hasGift && !isAd) {
        //     const userId = data.userId;
        const name = (data as any).origin?.message?.gift?.advertiserName;
        //     const icon = (({ comment }) => {
        //       const start = comment.indexOf('https://');
        //       return comment.substring(start, comment.indexOf('"', start));
        //     })(data);
        //     console.log(`[GIFT] ${name} ${icon}`);
        console.log(`[GIFT] ${name}`);
        if (data.anonymity) {
          this.speech(`ギフトありがとうございます！`);
          //       giftQueue.push({ userId, icon });
        } else {//if (!giftQueue.map(({ userId }) => userId).includes(userId)) {
          this.speech(`${name}さん、ギフトありがとうございます！`);
          //       giftQueue.push({ userId, name, icon });
        }
        continue;
      };
    }
  }

  #learn(text: `${string}。`) {
    this.#talkModel.learn(text);
  }

  onAir(state?: StreamData) {
    switch (state?.type) {
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
    ].includes(this.#browserState?.name ?? 'idle');
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

  get talkModel() {
    return this.#talkModel;
  }
}

export interface TalkModel {
  generate(start?: string): string
  learn(text: string): void
  toJSON(): string
}

type SpeechOptions = {
  additionalHalfTone?: number
  speakingRate?: number
};

export interface TTS {
  speech(text: string, options?: SpeechOptions): Promise<void>
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
  anonymity: boolean
  name?: string
  userId?: string
  hasGift: boolean
};
