import * as Browser from "../../../../Browser";
import { Action } from "../../../../Browser";

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

export function* solver(state: GameState = { type: 'initialize' }) {
  let result: Browser.State | undefined;
  do {
    console.debug('[DEBUG]', 'solver', 'state =', state);

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

        for (const action of actions) {
          // console.debug('[DEBUG]', 'action =', action);
          result = yield action;
          if (result?.name === 'closed') {
            return Action.noop;
          } else if (result?.name !== 'result' || !result.succeeded) {
            console.error(result);
            return Action.noop;
          };
        }

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

        for (const action of actions) {
          // console.debug('[DEBUG]', 'action =', action);
          result = yield action;
          if (action.name !== 'noop') {
            if (result?.name === 'closed') {
              return Action.noop;
            } else if (result?.name !== 'result' || !result.succeeded) {
              console.error(result);
              return Action.noop;
            };
          }
        }

        // state = state.count >= 1_000 ?
        //   {
        //     type: 'seeStats',
        //   } :
        //   {
        //     ...state,
        //     count: state.count + 1,
        //   };
        break;
      }
      case 'seeStats': {
        const actions = [
          Action.clickByText('記録'),
        ];

        for (const action of actions) {
          // console.debug('[DEBUG]', 'action =', action);
          result = yield action;
          if (result?.name === 'closed') {
            return Action.noop;
          } else if (result?.name !== 'result' || !result.succeeded) {
            console.error(result);
            return Action.noop;
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
        result = yield Action.noop;
        console.debug('[DEBUG]', 'result =', result);
        break;
      }
    }
    // console.debug('[DEBUG]', 'result =', result);
  } while (result?.name !== 'closed');
  console.log('[INFO]', 'solver end', state);
}
