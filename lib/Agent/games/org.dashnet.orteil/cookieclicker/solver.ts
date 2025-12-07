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
  }
  | { type: 'save' }
  | { type: 'closed' };

type SolverEventListeners = {
  onSave: Array<(text: string) => void>
};

export function* solver(state: GameState = { type: 'initialize' }, eventListeners: Partial<SolverEventListeners> = {}): Generator<Action.Action, undefined, State> {
  const listeners = { ...(eventListeners as SolverEventListeners) } as SolverEventListeners;
  listeners.onSave = listeners.onSave ?? [];

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
        const actions = [
          Action.open('https://orteil.dashnet.org/cookieclicker/'),
          Action.clickByText('日本語'),
          Action.clickByText('Got it'),
          Action.clickByText('次回から表示しない'),
        ];

        if (state.data) {
          actions.push(
            { name: 'press', key: 'Control+O' },
            {
              name: 'fill',
              value: state.data,
              on: { selector: '#game', role: 'textbox' },
            },
            { name: 'press', key: 'Enter' },
          );
        }

        if (!(yield* runActions(actions))) break;


        state = {
          type: 'idle',
          count: 0,
        };
        break;
      }
      case 'idle': {
        const actions = [
          Action.noop,
          Action.clickByElementId('bigCookie'),
        ];

        if (!(yield* runActions(actions))) break;


        state = state.count >= 1_000 ?
          {
            type: 'save',
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

          if (!(yield* runActions(actions))) break;
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

          if (!(yield* runActions(actions))) break;
        }
        state = { type: 'seeStats' };
        break;
      }
      case 'seeStats': {
        const actions = [
          Action.clickByText('記録'),
          Action.noop,
        ];

        if (!(yield* runActions(actions))) break;


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
