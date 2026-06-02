import { Activity, BarChart3, Cpu, Palette } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { create } from "zustand";
import Layout from "../../components/Layout";
import ApiManagementTab from "../../components/teacher/ApiManagementTab";
import MonitorTab from "../../components/teacher/MonitorTab";
import PromptManagementTab from "../../components/teacher/PromptManagementTab";
import PageHeader from "../../components/ui/PageHeader";
import Tabs from "../../components/ui/Tabs";

const useLLMTab = create((set) => ({
  tab: "monitor",
  setTab: (tab) => set({ tab }),
}));

const TABS = [
  { key: "monitor", icon: BarChart3, label: "调用监控" },
  { key: "api", icon: Cpu, label: "API 管理" },
  { key: "prompts", icon: Palette, label: "Prompt 管理" },
];

export default function LLMManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tab, setTab } = useLLMTab();

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && TABS.some((t) => t.key === urlTab)) {
      setTab(urlTab);
    }
  }, []);

  const handleTabChange = (key) => {
    setTab(key);
    setSearchParams({ tab: key }, { replace: true });
  };

  return (
    <Layout>
      <PageHeader title="LLM 管理" subtitle="调用监控 · API 密钥与用途配置 · Prompt 模板管理" icon={Activity} />
      <Tabs tabs={TABS} activeTab={tab} onChange={handleTabChange} />
      {tab === "monitor" && <MonitorTab />}
      {tab === "api" && <ApiManagementTab />}
      {tab === "prompts" && <PromptManagementTab />}
    </Layout>
  );
}
