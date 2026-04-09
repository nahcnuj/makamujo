import { Action, ActionResult } from "automated-gameplay-transmitter";
import { beforeAll, describe, expect, it } from "bun:test";
import { solver } from "./solver";

beforeAll(() => {
  console.debug = () => { };
});

const expectOk = (solve: Generator, action: any) => expect(solve.next(ActionResult.ok(action)).value);

describe('solver', () => {
  it('should initialize', () => {
    const solve = solver();

    expect(solve.next().value).toHaveProperty('name', 'open');

    const actions = [
      Action.clickByText('日本語'),
      Action.clickByText('Got it'),
      Action.clickByText('次回から表示しない'),
      Action.noop,
    ];

    let prev;
    for (const action of actions) {
      expectOk(solve, prev).toEqual(action);
      prev = action;
    }
  });

  it('should initialize with existing data', () => {
    const data = 'Mi4wNTJ8fDE3NjM4ODAzNTI5MTQ7MTc2Mzg4MDM1MjkxNDsxNzYzODgwMzYyNTE1O1RyaXBsZSBHbm9tZTt5dnJjZjswLDEsMCwwLDAsMCwwfDExMTExMTAxMTAwMTAxMTAwMTAxMDExMDAwMXwwOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzswOzA7MDswOzA7MDswOy0xOy0xOy0xOy0xOy0xOzA7MDswOzA7NzU7MDswOy0xOy0xOzE3NjM4ODAzNTI5MTQ7MDswOzs0MTswOzA7MDs1MDswOzA7fDAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7fDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDB8MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMHx8%21END%21';
    const solve = solver({
      type: 'initialize',
      data,
    });

    expect(solve.next().value).toHaveProperty('name', 'open');

    const actions = [
      Action.clickByText('日本語'),
      Action.clickByText('Got it'),
      Action.clickByText('次回から表示しない'),
      { name: 'press', key: 'Control+O' },
      { name: 'fill', value: data, on: { selector: '#game', role: 'textbox' } },
      { name: 'press', key: 'Enter' },
      Action.noop,
    ];

    let prev;
    for (const action of actions) {
      expectOk(solve, prev).toEqual(action);
      prev = action;
    }
  });

  it('should continue initialization when optional steps fail', () => {
    const solve = solver();

    expect(solve.next().value).toHaveProperty('name', 'open');

    // open succeeds
    expect(solve.next(ActionResult.ok(undefined) as any).value).toEqual(Action.clickByText('日本語'));

    // optional steps fail (e.g. dialogs not present) — initialization should continue
    expect(solve.next(ActionResult.error(Action.clickByText('日本語')) as any).value).toEqual(Action.clickByText('Got it'));
    expect(solve.next(ActionResult.error(Action.clickByText('Got it')) as any).value).toEqual(Action.clickByText('次回から表示しない'));
    expect(solve.next(ActionResult.error(Action.clickByText('次回から表示しない')) as any).value).toEqual(Action.noop);
  });

  it('should be done when got closed state', () => {
    const solve = solver({ type: 'closed' });
    expect(solve.next().done).toBeTrue();
  });

  it('should click a random clickable element in the idle state', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    };

    const solve = solver({ type: 'idle', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(Action.clickByElementId('bigCookie'));
  });

  it('should click one of the available clickable elements', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie', 'shimmer1', 'shimmer2'] },
    };

    const solve = solver({ type: 'idle', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    const clickAction = solve.next(idleState as any).value as any;
    expect(clickAction).toHaveProperty('name', 'click');
    expect(['bigCookie', 'shimmer1', 'shimmer2']).toContain(clickAction.target.id);
  });

  it('should fall back to clicking bigCookie when no clickable elements in state', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: [] },
    };

    const solve = solver({ type: 'idle', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(Action.clickByElementId('bigCookie'));
  });

  it('should redirect to cookie clicker when navigated to another page', () => {
    const wrongUrlState = {
      name: 'idle' as const,
      url: 'https://example.com/',
    };

    const solve = solver({ type: 'idle', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(wrongUrlState as any).value).toEqual(Action.open('https://orteil.dashnet.org/cookieclicker/'));
  });
});
