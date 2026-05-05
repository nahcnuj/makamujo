/** @jsxImportSource hono/jsx */
type AgentStatusHeaderProps = {
  streamTitle?: string;
  streamUrl?: string;
  startTime?: string;
};

export const AgentStatusHeader = ({ streamTitle, streamUrl, startTime }: AgentStatusHeaderProps) => {
  if (!streamTitle && !startTime) {
    return null;
  }

  return (
    <div className="flex flex-row items-center justify-center gap-2 min-w-0 text-center px-2">
      {streamTitle ? (
        streamUrl ? (
          <a
            data-testid="agent-status-stream-title"
            href={streamUrl}
            target="_blank"
            rel="noreferrer"
            className="text-base font-semibold text-emerald-100 underline decoration-emerald-300/50 hover:text-emerald-50 break-all"
          >
            {streamTitle}
          </a>
        ) : (
          <span data-testid="agent-status-stream-title" className="text-base font-semibold text-emerald-100 break-all">
            {streamTitle}
          </span>
        )
      ) : null}
      {startTime ? (
        <span data-testid="agent-status-start-time" className="text-sm text-emerald-200 whitespace-nowrap">
          {startTime}
        </span>
      ) : null}
    </div>
  );
};
