import { CookieClicker } from "automated-gameplay-transmitter";
import { solver as CookieClickerSolver } from "./org.dashnet.orteil/cookieclicker/solver";
import type { GameName } from "./index";

export const ServerGames = {
  CookieClicker: {
    ...CookieClicker,
    solver: CookieClickerSolver,
  },
} satisfies Record<GameName, object>;
