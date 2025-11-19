import type { Action } from "./Action";
import type { State } from "./State";

export const solve = (state: State): Action => {
  console.debug('[DEBUG]', 'solve', 'state', JSON.stringify(state, null, 0));
  return {
    action: undefined,
  };
};