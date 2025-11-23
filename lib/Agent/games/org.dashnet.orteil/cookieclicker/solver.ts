import type { Action, State } from "../../../../Browser/socket";

const timeoutMs = 10_000;

let waiting: Action | undefined;

export const solve = (s: State): Action => {
  console.debug('[DEBUG]', 'solve', s, 'waiting', waiting);

  if (waiting) {
    if (s.name === 'result') {
      if (!s.succeeded) {
        console.error('[ERROR]', 'failed action', s.action);
        return {
          name: 'noop',
        };
      }

      const action = s.action;
      switch (action.name) {
        case 'open': {
          return waiting = {
            name: 'click',
            target: '日本語', // TODO
            datetime: Date.now(),
          };
          break;
        }
        case 'click': {
          if (s.succeeded) {
            if (action.target === '日本語') { // TODO
              return waiting = {
                name: 'click',
                target: 'Got it',
                datetime: Date.now(),
              };
            }
            if (action.target === 'Got it') {
              return waiting = {
                name: 'click',
                target: '次回から表示しない',
                datetime: Date.now(),
              };
            }
            console.warn('[WARN]', 'unprocessed result', s);
          } else {
            console.error('[ERROR]', 'failed to click', s.action);
          }
          break;
        }
        default: {
          waiting = undefined;
          return {
            name: 'noop',
          };
        }
      }
    }

    if (waiting.name === 'click' && Date.now() - waiting.datetime > timeoutMs) {
      console.log('[INFO]', 'resend the waiting action', waiting);
      return waiting;
    }

    console.debug('[DEBUG]', 'waiting action...', waiting);
    return {
      name: 'noop',
    };
  }

  if (s.name === 'idle') {
    return {
      name: 'noop',
    };
  } else {
    console.warn('[WARN]', 'browser is not idle, noop');
    return {
      name: 'noop',
    };
  }
};
