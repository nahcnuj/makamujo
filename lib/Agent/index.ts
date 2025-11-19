export const play = (game: string) => {
  require(`./Player/${game}`)?.play?.();
};