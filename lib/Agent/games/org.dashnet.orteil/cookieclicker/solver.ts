import type { Action, State } from "../../../../Browser/socket";

type GameState =
  | {
    type: 'initialize'
  };

export function* solver(state: GameState = { type: 'initialize' }): Generator<Action> {
  let result: State | undefined;
  do {
    switch (state.type) {
      case 'initialize': {
        const actions: Action[] = [
          { name: 'open', url: 'https://orteil.dashnet.org/cookieclicker/' },
          { name: 'click', target: '日本語' },
          { name: 'click', target: 'Got it' },
          { name: 'click', target: '次回から表示しない' },
        ];

        for (const action of actions) {
          result = yield action;
          if (result?.name === 'closed') {
            return { name: 'noop' };
          } else if (result?.name !== 'result' || !result.succeeded) {
            return { error: 'ERROR', result }
          };
        }

        break;
      }
      default: {
        console.warn('[WARN]', 'state unprocessed', state);
        break;
      }
    }
  } while (result?.name !== 'closed');
}
