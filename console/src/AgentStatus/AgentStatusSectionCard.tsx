/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { AgentStatusRow } from "./types";

type AgentStatusSectionCardProps = {
  title?: string;
  titleRightElement?: Child;
  rows: AgentStatusRow[];
  className?: string;
  hideTitle?: boolean;
};

export const AgentStatusSectionCard = ({
  title,
  titleRightElement,
  rows,
  className = "",
  hideTitle = false,
}: AgentStatusSectionCardProps) => {
  return (
      <section className={[
        "bg-emerald-950/70 rounded-sm p-3 text-emerald-50 min-w-0 overflow-hidden flex flex-col",
        className,
      ].filter(Boolean).join(" ")}>
        {!hideTitle ? (
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="text-lg font-bold">{title}</h3>
            {titleRightElement ? (
              <div className="text-base whitespace-nowrap">{titleRightElement}</div>
            ) : null}
          </div>
        ) : null}
        <dl
          className="min-h-0 flex-1 grid content-start items-start grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 overflow-y-auto pr-1"
          style={{ scrollbarWidth: "thin" }}
        >
          {rows.map((row) => (
            <div
              key={`${title}:${row.label}:${"value" in row ? row.value : "value-component"}:${row.href ?? "-"}`}
              className="contents"
            >
              <dt className={row.hideLabel ? "hidden" : "font-bold whitespace-nowrap"}>{row.label}</dt>
              <dd className={[row.valueComponent ? "break-words" : "break-all", row.hideLabel ? "col-span-2" : ""].join(" ").trim()}>
                {row.valueComponent ?? (row.href ? (
                  <a className="underline" href={row.href} target="_blank" rel="noreferrer">
                    {row.value}
                  </a>
                ) : (
                  row.value
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>
  );
};
