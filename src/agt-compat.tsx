/**
 * Provide Hono-native versions of AGT layout primitives used by the frontend.
 *
 * The app uses `@jsxImportSource hono/jsx/dom` and must render with Hono's DOM
 * runtime. AGT's precompiled components are still built against React's JSX
 * runtime, so importing them directly can produce React element objects that
 * Hono cannot render correctly. The components below preserve the same props
 * and class-based structure, but render native Hono DOM elements.
 */
/** @jsxImportSource hono/jsx/dom */
import type { Child, FC } from "hono/jsx/dom";
import type {
  Box as AgTBox,
  Container as AgTContainer,
  Layout as AgTLayout,
  CharacterSprite as AgTCharacterSprite,
} from "automated-gameplay-transmitter";
export { useInterval } from "./hooks/useInterval";
export { HighlightOnChange } from "./components/HighlightOnChange";

// Derive the valid hono component return type from FC so we stay aligned
// with hono's own type definitions without importing internal hono types.
type HonoReturn = ReturnType<FC<{}>>;

type HonoizeChildren<Props> = Omit<Props, 'children'> & { children?: Child };

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

const sideClass = {
  "10_8": "col-span-2 row-span-8",
} as const;

const bottomClass = {
  "10_8": "col-span-10 row-span-2",
} as const;

function normalizeChildren(children: Child | Child[] | undefined): Child[] {
  if (children === undefined) return [];
  if (Array.isArray(children)) return children.flat(Infinity) as Child[];
  return [children];
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

export function Container({ children }: HonoizeChildren<Parameters<typeof AgTContainer>[0]>): HonoReturn {
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

  if (!Object.hasOwn(sideClass, countSpan)) {
    throw new Error(`No side-panel class found for the pair of count:${count} and span:${span}.`);
  }
  if (!Object.hasOwn(bottomClass, countSpan)) {
    throw new Error(`No bottom-panel class found for the pair of count:${count} and span:${span}.`);
  }

  return (
    <div className="w-screen h-screen content-center">
      <div className={`grid ${gridTemplateClass[count]} max-w-full max-h-full aspect-video`}>
        <div className={screenClass[span]}>
          <div className={`w-full h-full ${className}`}>{mainPanel}</div>
        </div>
        <div className={sideClass[countSpan]}>
          <div className={`w-full h-full ${className}`}>{sidePanel}</div>
        </div>
        <div className={bottomClass[countSpan]}>
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
      width="720"
      height="960"
      className={["h-full object-cover object-top", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
