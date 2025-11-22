import { randomUUID } from "node:crypto";
import type { Action, State } from "../../../../Browser/socket";

let waiting: Action | undefined;

export const solve = (s: State): Action => {
  console.debug('[DEBUG]', 'solve', s);

  if (s.name === 'clicked') {
    waiting = undefined;
    return {
      name: 'noop',
    };
  }

  if (waiting) {
    console.debug('[DEBUG]', 'waiting action', waiting);
    return {
      name: 'noop',
    };
  }

  if (s.name === 'opened') {
    return waiting = {
      name: 'click',
      target: '日本語', // TODO
      id: randomUUID(),
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
