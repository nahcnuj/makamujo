import type { Action, State } from "../../../../Browser/socket";

const url = 'https://orteil.dashnet.org/cookieclicker/';

let waiting: Action | undefined;

export const solve = (s: State): Action => {
  console.debug('[DEBUG]', 'solve', s);

  if (waiting === undefined) {
    switch (s.name) {
      case 'initialized': {
        return waiting = {
          name: 'open',
          url,
        };
      }
      default: {
        console.warn('[WARN]', 'unprocessed state', s);
        return {
          name: 'noop',
        };
      }
    }
  }

  console.debug('[DEBUG]', 'waiting result for action...', waiting);
  if (s.name !== 'result') {
    return {
      name: 'noop',
    };
  }

  if (!s.succeeded) {
    console.error('[ERROR]', 'failed action, retrying...', s.action);
    return s.action;
  }

  const action = s.action;
  switch (action.name) {
    case 'open': {
      return waiting = {
        name: 'click',
        target: '日本語', // TODO
        datetime: Date.now(),
      };
    }
    case 'click': {
      if (action.target === '日本語') { // TODO
        return waiting = {
          name: 'click',
          target: 'Got it',
          datetime: Date.now(),
        };
      }
      if (action.target === 'Got it') { // TODO
        return waiting = {
          name: 'click',
          target: '次回から表示しない', // TODO
          datetime: Date.now(),
        };
      }
      console.warn('[WARN]', 'unprocessed result', s);
      break;
    }
    default: {
      waiting = undefined;
      return {
        name: 'noop',
      };
    }
  }

  console.warn('[WARN]', 'unexpected state', s, waiting);
  return {
    name: 'noop',
  };
};
