import { Action, type AgentComment, type State } from "automated-gameplay-transmitter";
import { writeFileSync } from "node:fs";
import { createReceiver } from "../Browser/socket";
import { ServerGames as Games, type GameName } from "./games/server";
import type { AgentState } from "./State";

export const SILENCE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes

const N_GRAM_LOG_SCALE = 2;
const N_GRAM_LOG_BASELINE = 2;
const INITIAL_COMMENT_NUMBER = 1;

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

const inferNGramSizeRaw = (commentNumber: number): number => {
  const safeCommentNumber = Math.max(1, commentNumber);
  return (N_GRAM_LOG_SCALE * Math.log10(safeCommentNumber)) - N_GRAM_LOG_BASELINE;
};

const inferNGramSize = (commentNumber: number): number => {
  return Math.max(1, Math.floor(inferNGramSizeRaw(commentNumber)));
};

type SpeechEvent = {
  text: string;
  nGram?: number;
  nGramRaw?: number;
  nodes?: string[];
};

export class MakaMujo {
  #talkModel: TalkModel;
  #tts: TTS;

  #speechPromise = Promise.resolve();
  #speechListeners: Array<(event: SpeechEvent) => Promise<void>> = [];
  #speechCompleteListeners: Array<() => Promise<void>> = [];
  #ttsErrorHandlers: Array<(text: string, err: unknown) => void> = [];
  #gameStateChangeListeners: Array<() => void> = [];

  #browserState?: State;
  #playing?: {
    name: GameName
    state: ReturnType<typeof Games[GameName]['sight']>
  }

  #streamState?: AgentState;

  #lastListenerCount?: number;
  #listenersStaleSince?: Date;
  #lastCommentAt?: Date;
  // The URL of the currently active program. Used to scope comment counting
  #currentProgramUrl?: string;
  // Count of user comments received for the current program URL
  #currentProgramCommentCount = 0;
  #currentNGramSize = inferNGramSize(INITIAL_COMMENT_NUMBER);
  #currentNGramSizeRaw = inferNGramSizeRaw(INITIAL_COMMENT_NUMBER);
  #hasPromptedCommentForViewerIncrease = false;

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
      isSilent: () => !this.speechable,
    });
    try {
      createReceiver((state) => {
        // receiver callback is intentionally synchronous
        // and is expected to return an action for the solver.

        // (implementation below)

        // NOTE: the body of this function is unchanged.
        this.#browserState = state;
        console.debug('[DEBUG]', 'receiver got state', JSON.stringify(state, null, 0));

        if (state.name === 'closed') {
          this.#playing = undefined;
          this.#notifyGameStateChangeAsync();
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
            this.#notifyGameStateChangeAsync();
          }
        }

        const { done, value } = solver.next(state);
        if (done) {
          this.#playing = undefined;
          this.#notifyGameStateChangeAsync();
          return Action.noop;
        }
        console.debug('[DEBUG]', 'next action', JSON.stringify(value, null, 0));
        console.debug('[DEBUG]', 'sending action', JSON.stringify(value, null, 0));

        return value;
      });
    } catch (err) {
      console.warn('[WARN]', 'failed to start IPC receiver, continuing without browser IPC:', err instanceof Error ? err.message : String(err));
    }
  }

  async speech(generated?: TalkModelGenerateResult) {
    const event: SpeechEvent = typeof generated === 'string' ? { text: generated } : generated !== undefined ? {
      nGram: this.#currentNGramSize,
      nGramRaw: this.#currentNGramSizeRaw,
      ...generated,
    } : (() => {
      const ret = this.#talkModel.generate('', this.#currentNGramSize);
      return typeof ret === 'string' ? {
        text: ret,
      } : {
        nGram: this.#currentNGramSize,
        nGramRaw: this.#currentNGramSizeRaw,
        ...ret,
      };
    })();

    // Queue speech work onto the internal chain. For empty text we avoid
    // calling the underlying TTS implementation (some TalkModel generators
    // return an empty string) but still notify speech listeners.
    this.#speechPromise = this.#speechPromise.then(async () => {
      const tasks: Array<Promise<void>> = [
        ...this.#speechListeners.map(f => f(event)),
      ];
      const trimmedText = event.text.trim();
      if (trimmedText.length > 0) {
        const ttsTask = this.#tts.speech(trimmedText, { additionalHalfTone: 3, speakingRate: 1.2 }).catch((err) => {
          for (const h of this.#ttsErrorHandlers) {
            try { void h(trimmedText, err); } catch (_) { /* ignore handler errors */ }
          }
          throw err;
        });
        tasks.unshift(ttsTask);
      }
      await Promise.all(tasks);
      await Promise.all(this.#speechCompleteListeners.map(f => Promise.resolve(f())));
    }).catch(() => Promise.resolve());

    await this.#speechPromise;
  }

  onSpeech(cb: (event: SpeechEvent) => Promise<void>): MakaMujo {
    this.#speechListeners.push(cb);
    return this;
  }

  onTtsError(cb: (text: string, err: unknown) => void): MakaMujo {
    this.#ttsErrorHandlers.push(cb);
    return this;
  }

  onSpeechComplete(cb: () => Promise<void>): MakaMujo {
    this.#speechCompleteListeners.push(cb);
    return this;
  }

  onGameStateChange(cb: () => void): MakaMujo {
    this.#gameStateChangeListeners.push(cb);
    return this;
  }

  #notifyGameStateChangeAsync(): void {
    const listenersSnapshot = [...this.#gameStateChangeListeners];
    queueMicrotask(() => {
      for (const listener of listenersSnapshot) {
        try { listener(); } catch { }
      }
    });
  }

  listen(comments: AgentComment[]) {
    for (const { data } of comments) {
      const commentData = data as CommentData;
      const comment = commentData.comment.normalize('NFC').trim();
      console.debug('[DEBUG]', 'comment', JSON.stringify(data, null, 0));

      // Update last comment timestamp for any received comment that counts as activity.
      this.#lastCommentAt = new Date(Date.now());
      // Reset viewer-prompted flag when a real comment arrives
      this.#hasPromptedCommentForViewerIncrease = false;

      if (typeof data.no === 'number' && data.no > 0) {
        const commentNumber = data.no;
        this.#currentNGramSizeRaw = inferNGramSizeRaw(commentNumber);
        this.#currentNGramSize = inferNGramSize(commentNumber);
      }

      if (data.no || data.isOwner) {
        this.#learn(`${comment}。`);
      }

      if (data.no || (data.userId === 'onecomme.system' && data.name === '生放送クルーズ')) {
        console.log('[INFO]', `got a comment: "${comment}"`);
        // TODO reply
        const topic = pickTopic(comment);
        if (topic) {
          // console.debug('[DEBUG]', 'picked a word', `"${topic}"`, 'from', `"${comment}"`);
          this.speech(this.#talkModel.generate(topic, this.#currentNGramSize));
        }
      }

      let isAd = false; // FIXME

      if (data.userId === 'onecomme.system') {
        if (commentData.comment === '「生放送クルーズさん」が引用を開始しました') {
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

        if (commentData.comment.endsWith('広告しました')) {
          isAd = true;
          const name = commentData.comment.slice(commentData.comment.indexOf('】') + '】'.length, commentData.comment.lastIndexOf('さんが'));

          console.log('[INFO]', `AD ${name}`);
          this.speech(`${name}さん、広告ありがとうございます！`);
          continue;
        }

        if (commentData.comment === '配信終了1分前です') {
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

      // Count user comments for the current program URL. We treat comments
      // with a numeric `no` > 0 as user comments and ignore system messages.
      if (typeof commentData.no === 'number' && commentData.no > 0 && this.#currentProgramUrl) {
        this.#currentProgramCommentCount += 1;
        if (this.#streamState && this.#streamState.meta) {
          const existingTotal = this.#streamState.meta.total ?? { listeners: 0, gift: 0, ad: 0 };
          this.#streamState.meta = {
            ...this.#streamState.meta,
            total: { ...existingTotal, comments: this.#currentProgramCommentCount },
          };
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

  onAir(state: StreamData | unknown) {
    const streamData = state as StreamData | undefined;
    switch (streamData?.type) {
      case 'niconama': {
        const { isLive, title, startTime: start, url, total: listeners, points } = streamData.data;
        if (isLive) {
          // If the program URL changes, reset the per-program comment counter.
          if (this.#currentProgramUrl !== url) {
            this.#currentProgramUrl = url;
            this.#currentProgramCommentCount = 0;
            this.#hasPromptedCommentForViewerIncrease = false;
          }

          if (this.#lastListenerCount !== listeners) {
            this.#lastListenerCount = listeners;
            this.#listenersStaleSince = new Date(Date.now());
            const now = Date.now();
            const commentsStale = this.#lastCommentAt === undefined || (now - this.#lastCommentAt.getTime()) >= SILENCE_THRESHOLD_MS;
            const hadCommentBefore = this.#lastCommentAt !== undefined;
            // Only prompt viewers when the agent previously had comments but has
            // become silent due to no recent comments. Do not treat "never had
            // comments" as the silent state for prompting.
            if (hadCommentBefore && commentsStale) {
              if (!this.#hasPromptedCommentForViewerIncrease) {
                this.#hasPromptedCommentForViewerIncrease = true;
                // Call the prompt playback out-of-band so it doesn't wait on
                // the main speech queue. Notify speech listeners so the
                // console/UI is updated, and if the prompt playback fails,
                // clear the prompted flag so the agent can try again later.
                const promptText = 'コメントしていってね〜';
                // Queue the prompt through the normal speech queue so it respects
                // existing speech blocking. Register a temporary TTS error
                // handler to clear the prompted flag if playback fails.
                const clearOnError = (text: string, err: unknown) => {
                  if (text === promptText) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error('[ERROR]', 'prompting comment failed', msg);
                    this.#hasPromptedCommentForViewerIncrease = false;
                    this.#ttsErrorHandlers = this.#ttsErrorHandlers.filter(h => h !== clearOnError);
                  }
                };
                this.#ttsErrorHandlers.push(clearOnError);
                void this.speech(promptText);
              }
            }
          }
        } else {
          this.#lastListenerCount = undefined;
          this.#listenersStaleSince = undefined;
          // Clear current program tracking when offline
          this.#currentProgramUrl = undefined;
          this.#currentProgramCommentCount = 0;
        }

        this.#streamState = isLive ? {
          type: 'live',
          meta: {
            title,
            start,
            url,
            total: {
              listeners,
              gift: typeof points?.gift === 'string' ? Number.parseFloat(points.gift) : points?.gift,
              ad: typeof points?.ad === 'string' ? Number.parseFloat(points.ad) : points?.ad,
              comments: this.#currentProgramCommentCount,
            },
          },
        } : undefined;
        break;
      }
    }
  }

  get speechable() {
    const streamState = this.#streamState;
    if (streamState !== undefined) {
      const now = Date.now();
      const listenersStale = this.#listenersStaleSince !== undefined &&
        (now - this.#listenersStaleSince.getTime()) >= SILENCE_THRESHOLD_MS;
      const commentsStale = this.#lastCommentAt === undefined ||
        (now - this.#lastCommentAt.getTime()) >= SILENCE_THRESHOLD_MS;
      // If we've already prompted viewers to comment after a viewer increase,
      // remain silent until an actual comment arrives.
      if (commentsStale && this.#hasPromptedCommentForViewerIncrease) {
        return false;
      }
      if (listenersStale && commentsStale) {
        return false;
      }
    }

    return [
      'idle',
      'result',
      'closed',
    ].includes(this.#browserState?.name ?? 'idle');
  }

  get playing() {
    return this.#playing;
  }

  get canSpeak() {
    return this.speechable;
  }

  get currentGame() {
    return this.#playing;
  }

  get currentNGramSize() {
    return this.#currentNGramSize;
  }

  get currentNGramSizeRaw() {
    return this.#currentNGramSizeRaw;
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

export type TalkModelGenerateResult = string | { text: string; nodes?: string[] };

export interface TalkModel {
  generate(start?: string, nGram?: number): TalkModelGenerateResult
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
