import makamujo from "../public/nc433974.png";

const faces = {
  default: makamujo,
} as const;

type Props = {
  expression?: keyof typeof faces,
};

export function CharacterSprite({ expression = 'default' }: Props) {
  return (
    <img src={faces[expression]} height="50" className="transform-[scale(-1,1)]" />
  );
}