import { useEffect, useState } from "react";
import { api } from "@/api/axios-instance";

interface BackendPlugin {
  id: string;
  name: string;
  feature_flag: string | null;
  requires: string[];
  middleware_count: number;
  has_hooks: Record<string, boolean>;
  meta: { description: string; tags: string[] };
}

export default function PluginDashboard() {
  const [plugins, setPlugins] = useState<BackendPlugin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/admin/plugins")
      .then((res) => {
        setPlugins(res.data as BackendPlugin[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6">加载中...</div>;

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">插件注册表</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {plugins.map((p) => (
          <div key={p.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{p.name}</h3>
              <span className={`rounded px-2 py-0.5 text-xs ${p.feature_flag ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                {p.feature_flag ? `flag: ${p.feature_flag}` : "始终启用"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{p.meta.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.meta.tags.map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              中间件: {p.middleware_count} 个{p.requires.length > 0 && ` | 依赖: ${p.requires.join(", ")}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
