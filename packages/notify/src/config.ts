import type { NotifyConfig } from "./types";

export const DEFAULT_CONFIG: NotifyConfig = {
	priorityAllowlist: [],
	deliveryRetentionDays: 90,
};

export function resolveConfig(partial?: Partial<NotifyConfig>): NotifyConfig {
	return {
		priorityAllowlist: partial?.priorityAllowlist ?? DEFAULT_CONFIG.priorityAllowlist,
		deliveryRetentionDays: partial?.deliveryRetentionDays ?? DEFAULT_CONFIG.deliveryRetentionDays,
	};
}
