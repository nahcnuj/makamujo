import { ServerGames } from "./server";

export const Games = ServerGames;
export type GameName = keyof typeof Games;
