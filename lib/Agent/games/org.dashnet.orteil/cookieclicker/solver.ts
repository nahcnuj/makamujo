import type { Action, State } from "../../../../Browser/socket";

const game = 'CookieClicker';

type GameState =
  | undefined
  | {
    type: 'initialize'
    data?: string
  }
  | { type: 'idle' }

const init = {
  type: 'initialize',
} satisfies GameState;

export function* solver(state: GameState = init): Generator<Action> {
  let result: State | undefined;
  do {
    switch (state?.type) {
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
            return { name: 'noop' };
          } else if (result?.name !== 'result' || !result.succeeded) {
            return { error: 'ERROR', result }
          };
        }

        state = { type: 'idle' };

        break;
      }
      case 'idle': {
        // TODO
        result = yield { name: 'noop', game };
        console.debug('[DEBUG]', 'result =', result);
        result = yield clickByElementId('bigCookie');
        console.debug('[DEBUG]', 'result =', result);
        break;
      }
      default: {
        console.warn('[WARN]', 'state unprocessed', state);
        result = yield { name: 'noop', game };
        console.debug('[DEBUG]', 'result =', result);
        break;
      }
    }
  } while (result?.name !== 'closed');
}

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
