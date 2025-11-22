import { randomUUID } from "node:crypto";
import type { Action, State } from "../../../../Browser/socket";

let waiting: Action | undefined;

export const solve = (s: State): Action => {
  console.debug('[DEBUG]', 'solve', s);

  if (waiting) {
    if (s.name === 'clicked') {
      if (s.target === '日本語') { // TODO
        return waiting = {
          name: 'click',
          target: 'Got it',
        };
      } else if (s.target === 'Got it') {
        return waiting = {
          name: 'click',
          target: '次回から表示しない',
        };
      }

      waiting = undefined;
      return {
        name: 'noop',
      };
    }

    console.debug('[DEBUG]', 'waiting action', waiting);
    return {
      name: 'noop',
    };
  }

  if (s.name === 'opened') {
    return waiting = {
      name: 'click',
      target: '日本語', // TODO
    } satisfies Action;
  } else if (s.name === 'idle') {
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
