import type { Action, State } from "../../../../Browser/socket";

export const solve = (state: State): Action => {
  console.debug('[DEBUG]', 'solve', state);
  return {
    name: 'noop',
  };
};
