import * as CookieClicker from "./org.dashnet.orteil/cookieclicker/server";
import * as VigilantFiesta from "./work.nahcnuj.www/vigilant-fiesta/server";

export const ServerGames = {
  CookieClicker,
  VigilantFiesta,
} satisfies Record<string, unknown>;

export type GameName = keyof typeof ServerGames;
