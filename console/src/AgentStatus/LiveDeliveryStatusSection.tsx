import { AgentStatusSectionCard } from "./AgentStatusSectionCard";
import type { AgentStatusRow } from "./types";

export const LIVE_DELIVERY_SECTION_TITLE = "配信状況";

type LiveDeliveryStatusSectionProps = {
  liveDeliveryRows: AgentStatusRow[];
};

export const LiveDeliveryStatusSection = ({ liveDeliveryRows }: LiveDeliveryStatusSectionProps) => {
  return <AgentStatusSectionCard title={LIVE_DELIVERY_SECTION_TITLE} rows={liveDeliveryRows} hideTitle />;
};
