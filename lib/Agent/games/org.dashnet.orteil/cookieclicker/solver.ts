// NOTE: this solver is specific to the makamujo application and is
// intentionally kept outside of the shared library.  It relies on
// `Action`/`State` types defined by `automated-gameplay-transmitter`, but
// the strategy logic here is unique to the AI agent's behaviour.
import { Action, type State } from "automated-gameplay-transmitter";

type GameState =
  | undefined
  | {
    type: 'initialize'
    data?: string
  }
  | {
    type: 'idle'
    count: number
  }
  | {
    type: 'seeStats'
    failureCount: number
  }
  | { type: 'save'; failureCount: number }
  | { type: 'closed' };

type SolverEventListeners = {
  onSave: Array<(text: string) => void>
  isSilent: () => boolean
};

const MAX_CONSECUTIVE_FAILURES = 3;

export function* solver(state: GameState = { type: 'initialize' }, eventListeners: Partial<SolverEventListeners> = {}): Generator<Action.Action, undefined, State> {
  const listeners: SolverEventListeners = {
    onSave: [],
    isSilent: () => false,
    ...eventListeners,
  };

  function* runActions(actions: readonly Action.Action[]): Generator<Action.Action, boolean, State> {
    for (const action of actions) {
      const result = yield action;
      if (result.name === 'closed') {
        state = { type: 'closed' };
        return false;
      }
      if (action.name !== 'noop') {
        if (result.name === 'result') {
          if (!result.succeeded) {
            console.error(`failed to`, result.action);
            const escapeKeyPressResult = yield { name: 'press', key: 'Escape' } as const;
            if (escapeKeyPressResult.name === 'closed') {
              state = { type: 'closed' };
            }
            return false;
          }
        } else {
          console.warn('unexpected result', result);
        }
      }
    }
    return true;
  }

  while (state.type !== 'closed') {
    switch (state.type) {
      case 'initialize': {
        if (!(yield* runActions([Action.open('https://orteil.dashnet.org/cookieclicker/')]))) break;

        // These dialogs may not always appear (e.g. when already set or dismissed).
        // Treat each as optional: continue initialization even if a step fails.
        for (const action of [
          Action.clickByText('日本語'),
          Action.clickByText('Got it'),
          Action.clickByText('次回から表示しない'),
        ]) {
          const result = yield action;
          if (result.name === 'closed') {
            state = { type: 'closed' };
            break;
          }
        }

        if (state.type === 'closed') break;

        if (state.data) {
          if (!(yield* runActions([
            { name: 'press', key: 'Control+O' },
            {
              name: 'fill',
              value: state.data,
              on: { selector: '#game', role: 'textbox' },
            },
            { name: 'press', key: 'Enter' },
          ]))) break;
        }

        state = {
          type: 'idle',
          count: 0,
        };
        break;
      }
      case 'idle': {
        const noopResult = yield Action.noop;
        if (noopResult.name === 'closed') {
          state = { type: 'closed' };
          break;
        }

        if (noopResult.name === 'idle' && !noopResult.url.startsWith('https://orteil.dashnet.org/cookieclicker/')) {
          state = { type: 'initialize' };
          break;
        }

        const sightData = noopResult.name === 'idle' ? noopResult.state : undefined;
        const clickableElementIds = Array.isArray((sightData as any)?.clickableElementIds)
          ? (sightData as any).clickableElementIds as string[]
          : ['bigCookie'];
        const candidateIds = listeners.isSilent()
          ? ['bigCookie']
          : clickableElementIds.length > 0 ? clickableElementIds : ['bigCookie'];
        const targetId = candidateIds[Math.floor(Math.random() * candidateIds.length)]!;

        if (!(yield* runActions([Action.clickByElementId(targetId)]))) break;

        state = state.count >= 1_000 ?
          {
            type: 'save',
            failureCount: 0,
          } :
          {
            ...state,
            count: state.count + 1,
          };
        break;
      }
      case 'save': {
        {
          const actions = [
            Action.clickByText('オプション'),
            Action.clickByText('セーブをエクスポート'),
          ];

          if (!(yield* runActions(actions))) {
            if (state.type === 'save') {
              state = state.failureCount + 1 > MAX_CONSECUTIVE_FAILURES
                ? { type: 'idle', count: 0 }
                : { type: 'save', failureCount: state.failureCount + 1 };
            }
            break;
          }
        }

        {
          const result = yield Action.noop;
          if (result.name === 'idle' && result.selectedText) {
            const text = result.selectedText ?? '';
            listeners.onSave.forEach(f => f(text));
          }
        }

        {
          const actions = [
            { name: 'press', key: 'Escape' },
          ] as const;

          if (!(yield* runActions(actions))) {
            if (state.type === 'save') {
              state = state.failureCount + 1 > MAX_CONSECUTIVE_FAILURES
                ? { type: 'idle', count: 0 }
                : { type: 'save', failureCount: state.failureCount + 1 };
            }
            break;
          }
        }
        state = { type: 'seeStats', failureCount: 0 };
        break;
      }
      case 'seeStats': {
        const actions = [
          Action.clickByText('記録'),
          Action.noop,
        ];

        if (!(yield* runActions(actions))) {
          if (state.type === 'seeStats') {
            state = state.failureCount + 1 > MAX_CONSECUTIVE_FAILURES
              ? { type: 'idle', count: 0 }
              : { type: 'seeStats', failureCount: state.failureCount + 1 };
          }
          break;
        }

        state = {
          type: 'idle',
          count: 0,
        };
        break;
      }
      default: {
        const _: never = state;
        throw new Error('unreachable');
      }
    }
  }
}
