import type { AgentStatusSection } from "./types";

export const AgentStatusSectionCard = ({ title, rows }: AgentStatusSection) => {
  return (
    <section className="bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50">
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2">
        {rows.map((row) => (
          <div key={`${title}:${row.label}`} className="contents">
            <dt className="font-bold whitespace-nowrap">{row.label}</dt>
            <dd className="break-all">
              {row.href ? (
                <a className="underline" href={row.href} target="_blank" rel="noreferrer">
                  {row.value}
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
