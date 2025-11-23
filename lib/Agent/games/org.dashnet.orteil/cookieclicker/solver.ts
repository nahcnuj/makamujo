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
        result = yield {
          name: 'open',
          url: 'https://orteil.dashnet.org/cookieclicker/',
        };
        if (result?.name !== 'result' || !result.succeeded) return { error: 'ERROR', result };

        result = yield {
          name: 'click',
          target: '日本語',
        };
        if (result?.name !== 'result' || !result.succeeded) return { error: 'ERROR', result };

        result = yield {
          name: 'click',
          target: 'Got it',
        };
        if (result?.name !== 'result' || !result.succeeded) return { error: 'ERROR', result };

        result = yield {
          name: 'click',
          target: '次回から表示しない',
        };
        if (result?.name !== 'result' || !result.succeeded) return { error: 'ERROR', result };

        break;
      }
      default: {
        break;
      }
    }
  } while (result?.name !== 'closed');
}
