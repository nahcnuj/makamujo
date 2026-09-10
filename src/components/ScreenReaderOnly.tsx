/** Hide visually; keep content for assistive technologies. */
export function ScreenReaderOnly({ children }: { children?: string }) {
  return (
    <span
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: "0",
      }}
    >
      {children}
    </span>
  );
}
