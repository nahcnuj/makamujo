import { LIVE_DELIVERY_SECTION_TITLE } from "./constants";
import type { LiveDeliveryStatusSectionProps } from "./types";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

export const LiveDeliveryStatusSection = ({ liveDeliveryRows }: LiveDeliveryStatusSectionProps) => {
  return <AgentStatusSectionCard title={LIVE_DELIVERY_SECTION_TITLE} rows={liveDeliveryRows} />;
};
