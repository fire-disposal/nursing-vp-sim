import { BUILTIN_PLUGIN_DEFS } from "@/plugins/registry";
import type { FrontendPluginDef } from "./types";

let discovered: FrontendPluginDef[] | null = null;

export function discoverPluginDefs(): FrontendPluginDef[] {
	if (discovered) return discovered;
	discovered = BUILTIN_PLUGIN_DEFS;
	return discovered;
}
