import { CharacterSprite as GenericSprite } from "automated-gameplay-transmitter";

// simple wrapper that hard-codes the mascot image used by makamujo
export function CharacterSprite(props: Omit<React.ComponentProps<typeof GenericSprite>, 'src'>) {
  // NOTE: the public directory contains nc433974.png
  return <GenericSprite src="/nc433974.png" height="50" className="transform-[scale(-1,1)]" {...props} />;
}

