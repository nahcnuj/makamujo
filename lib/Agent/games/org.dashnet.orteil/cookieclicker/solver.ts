import type { Action, State } from "../../../../Browser/socket";

const url = 'https://orteil.dashnet.org/cookieclicker/';

let waiting: Action | undefined;

export const solve = (s: State): Action => {
  console.debug('[DEBUG]', 'solver got state', s);

  if (waiting === undefined) {
    switch (s.name) {
      case 'initialized': {
        return waiting = {
          name: 'open',
          url,
        };
      }
      case 'closed': {
        return {
          name: 'noop',
        };
      }
      default: {
        console.warn('[WARN]', 'state was unprocessed', s);
        return {
          name: 'noop',
        };
      }
    }
  }

  if (s.name !== 'result') {
    console.log('[INFO]', 'waiting result for action...', waiting);
    return {
      name: 'noop',
    };
  }

  if (!s.succeeded) {
    console.error('[ERROR]', 'failed action, retrying...', s.action);
    return s.action;
  }

  waiting = undefined;

  const action = s.action;
  switch (action.name) {
    case 'open': {
      return waiting = {
        name: 'click',
        target: '日本語', // TODO
      };
    }
    case 'click': {
      if (typeof action.target === 'string') {
        switch (action.target) {
          case '日本語': {
            return waiting = {
              name: 'click',
              target: 'Got it',
            };
          }
          case 'Got it': {
            return waiting = {
              name: 'click',
              target: '次回から表示しない',
            };
          }
        }
      }
    }
  }

  console.warn('[WARN]', 'state was unprocessed', s);
  return {
    name: 'noop',
  };
};
