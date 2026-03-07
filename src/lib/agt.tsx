import { useEffect, useRef, useState } from "react";

export function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full bg-black/50 border-5 border-double border-emerald-300 rounded-xl">
      {children}
    </div>
  );
}

export function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full p-1 overflow-hidden">
      {children}
    </div>
  );
}

const gridTemplateClass: Record<number, string> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-2 grid-rows-2",
  4: "grid-cols-4 grid-rows-4",
  8: "grid-cols-8 grid-rows-8",
  10: "grid-cols-10 grid-rows-10",
  16: "grid-cols-16 grid-rows-16",
};
const screenClass: Record<number, string> = {
  1: "col-span-1 row-span-1",
  2: "col-span-2 row-span-2",
  4: "col-span-4 row-span-4",
  8: "col-span-8 row-span-8",
  10: "col-span-10 row-span-10",
  16: "col-span-16 row-span-16",
};
const sideClass: Record<string, string> = { "10_8": "col-span-2 row-span-8" };
const bottomClass: Record<string, string> = { "10_8": "col-span-10 row-span-2" };

export function Layout({
  count,
  span,
  className,
  children: [mainPanel, sidePanel, bottomPanel],
}: {
  count: number;
  span: number;
  className?: string;
  children: [React.ReactNode, React.ReactNode, React.ReactNode];
}) {
  const count_span = `${count}_${span}`;
  if (!Object.hasOwn(sideClass, count_span))
    throw new Error(`No side-panel class found for the pair of count:${count} and span:${span}.`);
  if (!Object.hasOwn(bottomClass, count_span))
    throw new Error(`No bottom-panel class found for the pair of count:${count} and span:${span}.`);
  return (
    <div className="w-screen h-screen content-center">
      <div className={`grid ${gridTemplateClass[count]} max-w-full max-h-full aspect-video`}>
        <div className={screenClass[span]}>
          <div className={`w-full h-full ${className}`}>{mainPanel}</div>
        </div>
        <div className={sideClass[count_span]}>
          <div className={`w-full h-full ${className}`}>{sidePanel}</div>
        </div>
        <div className={bottomClass[count_span]}>
          <div className={`w-full h-full ${className}`}>{bottomPanel}</div>
        </div>
      </div>
    </div>
  );
}

export function HighlightOnChange({
  children,
  timeout,
  classNameOnChanged,
}: {
  children: React.ReactNode;
  timeout: number;
  classNameOnChanged: string;
}) {
  const [isHighlighting, setIsHighlighting] = useState(false);
  useEffect(() => {
    setIsHighlighting(true);
    const id = setTimeout(() => {
      setIsHighlighting(false);
    }, timeout);
    return () => {
      clearTimeout(id);
    };
  }, [children, timeout]);
  return (
    <div className={`${isHighlighting ? classNameOnChanged : ""}`}>
      {children}
    </div>
  );
}

export function CharacterSprite({
  src,
  className,
  ...props
}: {
  src: string;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <img
      src={src}
      width="720"
      height="960"
      className={`h-full object-cover object-top ${className}`}
      {...(props as object)}
    />
  );
}

export function useInterval(ms: number, f: () => Promise<void>) {
  const ref = useRef(f);
  useEffect(() => {
    ref.current = f;
  }, [f]);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    function run() {
      ref.current().catch(console.error).finally(() => {
        if (cancelled) return;
        id = setTimeout(run, ms);
      });
    }
    id = setTimeout(run, ms);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [ms]);
}
