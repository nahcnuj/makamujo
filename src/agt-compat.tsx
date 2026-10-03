/**
 * Provide Hono-native versions of AGT layout primitives used by the frontend.
 *
 * The app uses @jsxImportSource hono/jsx/dom and must render with Hono's DOM
 * runtime. AGT's precompiled components are still built against React's JSX
 * runtime, so importing them directly can produce React element objects that
 * Hono cannot render correctly. The components below preserve the same props
 * and class-based structure, but render native Hono DOM elements.
 */
import type { Child, FC } from "hono/jsx/dom";
import "hono/jsx/dom/jsx-dev-runtime";
import type {
  Box as AgTBox,
  CharacterSprite as AgTCharacterSprite,
  Container as AgTContainer,
  Layout as AgTLayout,
} from "automated-gameplay-transmitter";

export { HighlightOnChange } from "./components/HighlightOnChange";
export { useInterval } from "./hooks/useInterval";

// Derive the valid hono component return type from FC so we stay aligned
// with hono's own type definitions without importing internal hono types.
// `Record<string, never>` stands in for "no props" (`{}` is a banned type).
type HonoReturn = ReturnType<FC<Record<string, never>>>;

type HonoizeChildren<Props> = Omit<Props, "children"> & { children?: Child };

const screenClass = {
  1: "col-span-1 row-span-1",
  2: "col-span-2 row-span-2",
  4: "col-span-4 row-span-4",
  8: "col-span-8 row-span-8",
  10: "col-span-10 row-span-10",
  16: "col-span-16 row-span-16",
} as const;

const gridTemplateClass = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-2 grid-rows-2",
  4: "grid-cols-4 grid-rows-4",
  8: "grid-cols-8 grid-rows-8",
  10: "grid-cols-10 grid-rows-10",
  16: "grid-cols-16 grid-rows-16",
} as const;

// Keyed by `${count}_${span}`, which is computed at runtime and therefore cannot be narrowed by the compiler.
const sideClass: Readonly<Record<string, string>> = {
  "10_8": "col-span-2 row-span-8",
};

const bottomClass: Readonly<Record<string, string>> = {
  "10_8": "col-span-10 row-span-2",
};

/**
 * Flatten `children` into a list.
 *
 * `Array#flat(Infinity)` on a union of Hono `Child` types makes the compiler
 * give up ("Type instantiation is excessively deep"), so nesting is unwound
 * explicitly instead.
 */
function normalizeChildren(children: Child | Child[] | undefined): Child[] {
  if (children === undefined) return [];
  if (!Array.isArray(children)) return [children];
  const flattened: Child[] = [];
  for (const child of children) {
    flattened.push(...normalizeChildren(child));
  }
  return flattened;
}

export function Box({
  bgColor = "bg-black",
  borderColor = "border-white",
  borderStyle = "border-solid",
  borderWidth = "border",
  rounded,
  children,
}: HonoizeChildren<Parameters<typeof AgTBox>[0]>): HonoReturn {
  const className = [
    "w-full",
    "h-full",
    bgColor,
    borderColor,
    borderStyle,
    borderWidth,
    rounded,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={className}>{children}</div>;
}

export function Container({
  children,
}: HonoizeChildren<Parameters<typeof AgTContainer>[0]>): HonoReturn {
  return <div className="h-full p-1 overflow-hidden">{children}</div>;
}

export function Layout({
  count,
  span,
  className = "",
  children,
}: HonoizeChildren<Parameters<typeof AgTLayout>[0]>): HonoReturn {
  const childArray = normalizeChildren(children);
  const [mainPanel, sidePanel, bottomPanel] = childArray;
  const countSpan = `${count}_${span}`;

  const sideClassName = sideClass[countSpan];
  const bottomClassName = bottomClass[countSpan];
  if (sideClassName === undefined) {
    throw new Error(
      `No side-panel class found for the pair of count:${count} and span:${span}.`,
    );
  }
  if (bottomClassName === undefined) {
    throw new Error(
      `No bottom-panel class found for the pair of count:${count} and span:${span}.`,
    );
  }

  return (
    <div className="w-screen h-screen content-center">
      <div
        className={`grid ${gridTemplateClass[count]} max-w-full max-h-full aspect-video`}
      >
        <div className={screenClass[span]}>
          <div className={`w-full h-full ${className}`}>{mainPanel}</div>
        </div>
        <div className={sideClassName}>
          <div className={`w-full h-full ${className}`}>{sidePanel}</div>
        </div>
        <div className={bottomClassName}>
          <div className={`w-full h-full ${className}`}>{bottomPanel}</div>
        </div>
      </div>
    </div>
  );
}

export function CharacterSprite({
  src,
  className = "",
  ...rest
}: HonoizeChildren<Parameters<typeof AgTCharacterSprite>[0]>): HonoReturn {
  return (
    <img
      src={src}
      alt=""
      width="720"
      height="960"
      className={["h-full object-cover object-top", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
