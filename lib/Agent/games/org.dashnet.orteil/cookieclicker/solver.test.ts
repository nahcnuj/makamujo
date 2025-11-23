import { beforeAll, describe, expect, it } from "bun:test";
import { solver } from "./solver";

beforeAll(() => {
  console.debug = () => {};
});

describe('solver', () => {
  it('should initialize', () => {
    const solve = solver();

    expect(solve.next().value).toHaveProperty('name', 'open');

    expect(solve.next({
      name: 'result',
      succeeded: true,
    }).value).toEqual({
      name: 'click',
      target: '日本語',
    });

    expect(solve.next({
      name: 'result',
      succeeded: true,
    }).value).toEqual({
      name: 'click',
      target: 'Got it',
    });

    expect(solve.next({
      name: 'result',
      succeeded: true,
    }).value).toEqual({
      name: 'click',
      target: '次回から表示しない',
    });
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
