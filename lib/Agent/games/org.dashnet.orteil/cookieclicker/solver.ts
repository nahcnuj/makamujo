import type { Action, State } from "../../../../Browser/socket";

type GameState =
  | undefined
  | { type: 'initialize' }
  | { type: 'idle' }

export function* solver(state: GameState = { type: 'initialize' }): Generator<Action> {
  let result: State | undefined;
  do {
    switch (state?.type) {
      case 'initialize': {
        const actions: Action[] = [
          { name: 'open', url: 'https://orteil.dashnet.org/cookieclicker/' },
          { name: 'click', target: '日本語' },
          { name: 'click', target: 'Got it' },
          { name: 'click', target: '次回から表示しない' },
        ];

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
        result = yield { name: 'noop' };
        console.debug('[DEBUG]', 'result =', result);
        break;
      }
      default: {
        console.warn('[WARN]', 'state unprocessed', state);
        result = yield { name: 'noop' };
        console.debug('[DEBUG]', 'result =', result);
        break;
      }
    }
  } while (result?.name !== 'closed');
}
