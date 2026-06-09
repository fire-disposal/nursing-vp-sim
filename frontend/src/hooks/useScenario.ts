import { useEffect, useState } from "react";
import { fetchRecordScenario, type ScenarioConfigResponse } from "@/api/scenarios";

export function useScenario(recordId: string | undefined) {
  const [scenario, setScenario] = useState<ScenarioConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recordId) return;
    setLoading(true);
    fetchRecordScenario(recordId)
      .then(setScenario)
      .catch(() => setScenario(null))
      .finally(() => setLoading(false));
  }, [recordId]);

  return { scenario, loading };
}
