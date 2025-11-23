import { beforeAll, describe, expect, it } from "bun:test";
import { ok } from "../../../../Browser/socket";
import { solver } from "./solver";

beforeAll(() => {
  console.debug = () => {};
});

const expectOk = (solve: Generator, action: any) => expect(solve.next(ok(action)).value);

describe('solver', () => {
  it('should initialize', () => {
    const solve = solver();

    expect(solve.next().value).toHaveProperty('name', 'open');

    const actions = [
      { name: 'click', target: '日本語' },
      { name: 'click', target: 'Got it' },
      { name: 'click', target: '次回から表示しない' },
      { name: 'noop' },
    ];

    let prev;
    for (const action of actions) {
      expectOk(solve, prev).toEqual(action);
      prev = action;
    }
  });

  it('should be done when got closed state', () => {
    const solve = solver();

    solve.next({ name: 'closed' });
    expect(solve.next().done).toBeTrue();
  });

  it('should keep no-op in the idle state', () => {
    const solve = solver({ type: 'idle' });

    expect(solve.next().value).toEqual({ name: 'noop' });
  });
});
