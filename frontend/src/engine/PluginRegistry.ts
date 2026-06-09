import type { PluginRuntime, PluginStatus, SlotName, TrainingPlugin } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, TrainingPlugin>();
  private featureFlags: Record<string, boolean> = {};
  private _version = 0;

  get version(): number {
    return this._version;
  }

  register(plugin: TrainingPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRegistry] duplicate plugin id ignored: ${plugin.id}`);
      return;
    }
    this.plugins.set(plugin.id, { ...plugin });
  }

  getAll(): TrainingPlugin[] {
    return Array.from(this.plugins.values());
  }

  getActive(featureFlags?: Record<string, boolean>): TrainingPlugin[] {
    const flags = featureFlags ?? this.featureFlags;
    return Array.from(this.plugins.values()).filter((p) => this.isActive(p, flags));
  }

  getSlots(slotName: SlotName, featureFlags?: Record<string, boolean>): TrainingPlugin[] {
    return this.getActive(featureFlags).filter((p) => p.slots?.[slotName]);
  }

  isActive(plugin: TrainingPlugin, featureFlags: Record<string, boolean>): boolean {
    if (plugin.requires?.length) {
      const allDepsMet = plugin.requires.every((depId) => {
        const dep = this.plugins.get(depId);
        return dep && this.isActive(dep, featureFlags);
      });
      if (!allDepsMet) return false;
    }
    if (plugin.featureFlag !== undefined) {
      if (!featureFlags[plugin.featureFlag]) return false;
    }
    return true;
  }

  setFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlags = { ...flags };
    this._version++;
  }

  updateRuntime(pluginId: string, update: Partial<PluginRuntime>): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    plugin.runtime = {
      status: "active" as PluginStatus,
      hookCalls: {},
      ...plugin.runtime,
      ...update,
    };
  }
}

export const pluginRegistry = new PluginRegistry();
