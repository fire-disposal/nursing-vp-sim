import type { PanelPlugin } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, PanelPlugin>();
  private featureFlags: Record<string, boolean> = {};
  private _version = 0;

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

  getAll(): PanelPlugin[] {
    return Array.from(this.plugins.values());
  }

  getActive(featureFlags?: Record<string, boolean>): PanelPlugin[] {
    const flags = featureFlags ?? this.featureFlags;
    return Array.from(this.plugins.values())
      .filter((p) => this.isActive(p, flags))
      .sort((a, b) => (a.tab.priority ?? 99) - (b.tab.priority ?? 99));
  }

  isActive(plugin: PanelPlugin, flags: Record<string, boolean>): boolean {
    if (plugin.featureFlag !== undefined) {
      if (!flags[plugin.featureFlag]) return false;
    }
    if (plugin.requires) {
      for (const depId of plugin.requires) {
        const dep = this.plugins.get(depId);
        if (!dep) return false;
        if (dep.featureFlag !== undefined && !flags[dep.featureFlag]) return false;
      }
    }
    return true;
  }

  setFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlags = { ...flags };
    this._version++;
  }
}

export const pluginRegistry = new PluginRegistry();
