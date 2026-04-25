import type { AgentStatusRow } from "./AgentStatusSectionCard";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

export const LIVE_DELIVERY_SECTION_TITLE = "配信状況";

export const LiveDeliveryStatusSection = ({ liveDeliveryRows }: { liveDeliveryRows: AgentStatusRow[] }) => {
    return <AgentStatusSectionCard title={LIVE_DELIVERY_SECTION_TITLE} rows={liveDeliveryRows} />;
};
