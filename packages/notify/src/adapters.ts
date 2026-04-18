import { NotifyConfigError } from "./errors";
import type { Adapter, ChannelName } from "./types";

/**
 * Per-NotifyDeps adapter registry. Keep instances local to your dispatch
 * setup — global module-level registries make tests painful.
 */
export class AdapterRegistry {
	private map = new Map<ChannelName, Adapter<unknown>>();

	register<P>(name: ChannelName, adapter: Adapter<P>): void {
		this.map.set(name, adapter as Adapter<unknown>);
	}

	get(name: ChannelName): Adapter<unknown> | undefined {
		return this.map.get(name);
	}

	require(name: ChannelName): Adapter<unknown> {
		const a = this.map.get(name);
		if (!a) {
			throw new NotifyConfigError(`no adapter registered for channel "${name}"`);
		}
		return a;
	}

	channels(): ChannelName[] {
		return [...this.map.keys()];
	}
}

export function buildRegistry(adapters: Record<ChannelName, Adapter<unknown>>): AdapterRegistry {
	const r = new AdapterRegistry();
	for (const [name, a] of Object.entries(adapters)) {
		r.register(name, a);
	}
	return r;
}
