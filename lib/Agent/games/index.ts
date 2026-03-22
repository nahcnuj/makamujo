import * as CookieClicker from "./org.dashnet.orteil/cookieclicker";

export const Games = {
  CookieClicker,
} satisfies Record<string, unknown>;

export type GameName = keyof typeof Games;
