import type { PanelPlugin } from "./types";

export class PluginRegistry {
	private plugins = new Map<string, PanelPlugin>();
	private featureFlags: Record<string, boolean> = {};
	private _version = 0;
	private manifestPlugins: Array<{
		id: string;
		requires: string[];
		feature_flag?: string;
	}> = [];

	get version(): number {
		return this._version;
	}

	register(plugin: PanelPlugin): void {
		if (this.plugins.has(plugin.id)) {
			return;
		}
		this.plugins.set(plugin.id, { ...plugin });
		this._version++;
	}

	setManifest(manifest: {
		plugins: Array<{
			id: string;
			requires: string[];
			feature_flag?: string;
		}>;
	}): void {
		this.manifestPlugins = manifest.plugins;
		this._version++;
	}

	getAll(): PanelPlugin[] {
		return Array.from(this.plugins.values());
	}

	getActive(featureFlags?: Record<string, boolean>): PanelPlugin[] {
		const flags = featureFlags ?? this.featureFlags;
		const manifestMap = new Map(this.manifestPlugins.map((p) => [p.id, p]));
		return Array.from(this.plugins.values())
			.filter((p) => {
				const mp = manifestMap.get(p.id);
				if (!mp) return false;
				return this._isActiveInManifest(mp, manifestMap, flags);
			})
			.sort(
				(a, b) => (a.tab.priority ?? 99) - (b.tab.priority ?? 99),
			);
	}

	private _isActiveInManifest(
		mp: {
			id: string;
			requires: string[];
			feature_flag?: string;
		},
		manifestMap: Map<
			string,
			{ id: string; requires: string[]; feature_flag?: string }
		>,
		flags: Record<string, boolean>,
	): boolean {
		if (mp.feature_flag !== undefined) {
			if (!flags[mp.feature_flag]) return false;
		}
		for (const depId of mp.requires) {
			const dep = manifestMap.get(depId);
			if (!dep) return false;
			if (!this._isActiveInManifest(dep, manifestMap, flags))
				return false;
		}
		return true;
	}

	setFeatureFlags(flags: Record<string, boolean>): void {
		this.featureFlags = { ...flags };
		this._version++;
	}
}

export const pluginRegistry = new PluginRegistry();
