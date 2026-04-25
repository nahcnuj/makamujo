import { Container } from "automated-gameplay-transmitter";
import type { ReactNode } from "react";

export type AgentStatusRow = {
  label: string
  href?: string
  hideLabel?: boolean
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

export const AgentStatusSectionCard = ({ title, rows }: AgentStatusSectionCardProps) => {
  return (
    <Container>
      <section className="bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50 min-w-0 h-full overflow-hidden flex flex-col">
        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <dl className="min-h-0 flex-1 grid content-start items-start grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2 overflow-y-auto pr-1">
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
    </Container>
  );
};
