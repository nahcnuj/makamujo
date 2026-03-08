import * as CookieClicker from "./org.dashnet.orteil/cookieclicker/server";

export const ServerGames = {
  CookieClicker,
} satisfies Record<string, unknown>;

export type GameName = keyof typeof ServerGames;
