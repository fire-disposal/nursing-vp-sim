import type { FrontendPluginDef } from "./types";

interface PluginModule {
	default: FrontendPluginDef;
}

const pluginModules = import.meta.glob<PluginModule>(
	"@/plugins/*/index.{ts,tsx}",
	{ eager: true },
);

let discovered: FrontendPluginDef[] | null = null;

export function discoverPluginDefs(): FrontendPluginDef[] {
	if (discovered) return discovered;
	discovered = Object.values(pluginModules)
		.filter((m): m is PluginModule => !!m?.default?.id)
		.map((m) => m.default);
	return discovered;
}
