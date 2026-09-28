export type ActivitySourceCapabilities = {
  incomingTransfers: boolean;
  completeHistory: boolean;
};

export const BROWSER_LOCAL_ACTIVITY_CAPABILITIES: ActivitySourceCapabilities = {
  incomingTransfers: false,
  completeHistory: false,
};

export function activityFilters(capabilities: ActivitySourceCapabilities): readonly { value: "all" | "sent" | "received" | "swap"; label: string }[] {
  return capabilities.completeHistory
    ? [{ value: "all", label: "All" }, { value: "sent", label: "Sent" }, { value: "received", label: "Received" }, { value: "swap", label: "Swaps" }]
    : [{ value: "all", label: "All" }, { value: "sent", label: "Sent" }, { value: "swap", label: "Swaps" }];
}

export function includeActivityItem(kind: "sent" | "received" | "swap", filter: "all" | "sent" | "swap", capabilities: ActivitySourceCapabilities): boolean {
  if (kind === "received" && !capabilities.incomingTransfers) return false;
  if (filter === "all") return true;
  return kind === filter;
}
