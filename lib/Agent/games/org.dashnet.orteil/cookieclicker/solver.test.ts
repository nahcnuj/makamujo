import { describe, expect, it } from "bun:test";
import { solver } from "./solver";

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

  // it('should end when got closed state', () => {
  //   const solve = solver();

  //   solve.next({ name: 'closed' });
  //   expect(solve.next({ name: 'closed' }).value).toHaveProperty('name', 'open');
  //   expect(solve.next({ name: 'closed' }).done).toBeTrue();
  //   expect(solve.next({ name: 'closed' }).done).toBeTrue();
  // });
});
