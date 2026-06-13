import { expect, test } from "bun:test";
import { Box, CharacterSprite, Container, Layout } from "./agt-compat";

test("Box returns a Hono JSX element wrapper", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = (
    <Box
      borderColor="border-emerald-300"
      borderWidth="border-8"
      borderStyle="border-double"
      rounded="rounded-xl"
    >
      test
    </Box>
  ) as any;

  expect(element.tag).toBe(Box);
  expect(element.props.className).toBeUndefined();
  expect(element.props.children).toBe("test");
});

test("Layout returns a Hono JSX element wrapper with three children", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = (
    <Layout count={10} span={8} className="bg-emerald-950/30">
      <Container>main</Container>
      <Container>side</Container>
      <Container>bottom</Container>
    </Layout>
  ) as any;

  expect(element.tag).toBe(Layout);
  expect(Array.isArray(element.props.children)).toBe(true);
  expect(element.props.children).toHaveLength(3);
  expect(element.props.children[0].tag).toBe(Container);
  expect(element.props.children[1].tag).toBe(Container);
  expect(element.props.children[2].tag).toBe(Container);
});

test("CharacterSprite returns a Hono JSX element wrapper", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = (
    <CharacterSprite
      src="/nc433974.png"
      height="50"
      className="transform-[scale(-1,1)]"
    />
  ) as any;

  expect(element.tag).toBe(CharacterSprite);
  expect(element.props.src).toBe("/nc433974.png");
  expect(element.props.className).toBe("transform-[scale(-1,1)]");
});
