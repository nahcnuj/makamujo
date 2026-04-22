import type { ReactNode } from "react";

export type AgentStatusRow = {
  label: string
  href?: string
} & (
  | {
    value: string
    valueComponent?: never
  }
  | {
    value?: never
    valueComponent: ReactNode
  }
);

type AgentStatusSectionCardProps = {
  title: string
  rows: AgentStatusRow[]
};

const SECTION_CONTENT_MAX_HEIGHT_SVH = 42;

export const AgentStatusSectionCard = ({ title, rows }: AgentStatusSectionCardProps) => {
  return (
    <section className="bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50 min-w-0 min-h-0 overflow-hidden">
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <dl
        className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2 overflow-y-auto pr-1"
        style={{ maxHeight: `${SECTION_CONTENT_MAX_HEIGHT_SVH}svh` }}
      >
        {rows.map((row) => (
          <div key={`${title}:${row.label}`} className="contents">
            <dt className="font-bold whitespace-nowrap">{row.label}</dt>
            <dd className={row.valueComponent ? "break-words" : "break-all"}>
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
