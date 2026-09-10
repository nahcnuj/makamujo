import * as CookieClicker from "./org.dashnet.orteil/cookieclicker";
import * as VigilantFiesta from "./work.nahcnuj.www/vigilant-fiesta";

export const Games = {
  CookieClicker,
  VigilantFiesta,
} satisfies Record<string, unknown>;

export type GameName = keyof typeof Games;
