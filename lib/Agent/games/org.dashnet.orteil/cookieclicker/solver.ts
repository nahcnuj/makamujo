import type { Action, State } from "../../../../Browser/socket";

const game = 'CookieClicker';

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

const init = {
  type: 'initialize',
} satisfies GameState;

export function* solver(state: GameState = init): Generator<Action> {
  let result: State | undefined;
  do {
    console.debug('[DEBUG]', 'solver', 'state =', state);

    switch (state.type) {
      case 'initialize': {
        const actions: Action[] = [
          { name: 'open', url: 'https://orteil.dashnet.org/cookieclicker/' },
          clickByText('日本語'),
          clickByText('Got it'),
          clickByText('次回から表示しない'),
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

        for (const action of actions) {
          console.debug('[DEBUG]', 'action =', action);
          result = yield action;
          if (result?.name === 'closed') {
            return { ...noop, name: undefined };
          } else if (result?.name !== 'result' || !result.succeeded) {
            return { error: 'ERROR', result };
          };
        }

        state = {
          type: 'idle',
          count: 0,
        };
        break;
      }
      case 'idle': {
        result = yield noop;
        console.debug('[DEBUG]', 'result =', result);
        result = yield clickByElementId('bigCookie');
        console.debug('[DEBUG]', 'result =', result);

        state = state.count >= 1_000 ?
          {
            type: 'seeStats',
          } :
          {
            ...state,
            count: state.count + 1,
          };
        break;
      }
      case 'seeStats': {
        const actions: Action[] = [
          clickByText('記録'),
          noop,
        ];

        for (const action of actions) {
          console.debug('[DEBUG]', 'action =', action);
          result = yield action;
          if (result?.name === 'closed') {
            return { ...noop, game: undefined };
          } else if (result?.name !== 'result' || !result.succeeded) {
            return { error: 'ERROR', result };
          };
        }

        state = {
          type: 'idle',
          count: 0,
        };
        break;
      }
      default: {
        console.warn('[WARN]', 'state unprocessed', state);
        result = yield noop;
        console.debug('[DEBUG]', 'result =', result);
        break;
      }
    }
    console.debug('[DEBUG]', 'result =', result);
  } while (result?.name !== 'closed');
  console.debug('[DEBUG]', 'solver end');
}

export const noop = { name: 'noop', game } as const;

export function clickByText(text: string): Action {
  return {
    name: 'click',
    target: {
      type: 'text',
      text,
    },
  };
}

export function clickByElementId(id: string): Action {
  return {
    name: 'click',
    target: {
      type: 'id',
      id,
    },
  };
}
