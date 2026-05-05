/** @jsxImportSource hono/jsx/dom */
import { CharacterSprite as GenericSprite } from "../agt-compat";

// simple wrapper that hard-codes the mascot image used by makamujo
export function CharacterSprite(props: Omit<Parameters<typeof GenericSprite>[0], 'src'>) {
  // NOTE: the public directory contains nc433974.png
  return <GenericSprite src="/nc433974.png" height="50" className="transform-[scale(-1,1)]" {...props} />;
}

