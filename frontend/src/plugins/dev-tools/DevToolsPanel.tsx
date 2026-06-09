import { useEffect, useState } from "react";
import { pluginRegistry } from "@/engine/PluginRegistry";
import type { SlotProps } from "@/engine/types";

interface BusLog {
  time: string;
  event: string;
  args: string;
}

export function DevToolsPanel({ ctx, features }: SlotProps) {
  const [activeTab, setActiveTab] = useState<"plugins" | "events" | "flags">("plugins");
  const [busLogs, setBusLogs] = useState<BusLog[]>([]);
  const [_refresh, setRefresh] = useState(0);

  useEffect(() => {
    const allEvents = ctx.bus.listEvents();
    const unsubs = allEvents.map((evt) =>
      ctx.bus.on(evt, (...args: any[]) => {
        setBusLogs((prev) => {
          const log: BusLog = {
            time: new Date().toLocaleTimeString(),
            event: evt,
            args: JSON.stringify(args).slice(0, 100),
          };
          return [...prev.slice(-99), log];
        });
      }),
    );
    return () => {
      unsubs.forEach((fn) => {
        fn();
      });
    };
  }, [ctx.bus]);

  const plugins = pluginRegistry.getAll();

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card text-xs">
      <div className="flex border-b">
        {(["plugins", "events", "flags"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 ${activeTab === tab ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            {tab === "plugins" ? "插件" : tab === "events" ? "事件" : "开关"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-2">
        {activeTab === "plugins" && (
          <div className="space-y-1">
            {plugins.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                <span className="font-medium">{p.name}</span>
                <span className={`size-1.5 rounded-full ${p.featureFlag && !features[p.featureFlag] ? "bg-gray-400" : "bg-green-500"}`} />
              </div>
            ))}
          </div>
        )}

        {activeTab === "events" && (
          <div className="space-y-0.5 font-mono">
            {busLogs.map((log, i) => (
              <div key={i} className="flex gap-2 opacity-70">
                <span className="text-muted-foreground">{log.time}</span>
                <span className="text-blue-500">{log.event}</span>
                <span className="truncate text-muted-foreground">{log.args}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "flags" && (
          <div className="space-y-2">
            {Object.entries(features).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between">
                <span>{key}</span>
                <button
                  type="button"
                  onClick={() => {
                    const newFlags = { ...features, [key]: !val };
                    pluginRegistry.setFeatureFlags(newFlags);
                    setRefresh((r) => r + 1);
                  }}
                  className={`rounded px-2 py-0.5 ${val ? "bg-green-500/20 text-green-600" : "bg-gray-200 text-gray-500"}`}
                >
                  {val ? "ON" : "OFF"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
