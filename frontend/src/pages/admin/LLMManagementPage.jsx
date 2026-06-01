import { Activity, BarChart3, Key, Palette, Server, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../../components/Layout";
import ApiManagementTab from "../../components/teacher/ApiManagementTab";
import MonitorTab from "../../components/teacher/MonitorTab";
import PromptManagementTab from "../../components/teacher/PromptManagementTab";
import PageHeader from "../../components/ui/PageHeader";
import Tabs from "../../components/ui/Tabs";

const TABS = [
  { key: "monitor", icon: BarChart3, label: "调用监控" },
  { key: "configs", icon: Server, label: "用途配置" },
  { key: "secrets", icon: Key, label: "密钥凭证" },
  { key: "health", icon: ShieldCheck, label: "连通性" },
  { key: "prompts", icon: Palette, label: "Prompt 管理" },
];

export default function LLMManagementPage({ user, onLogout }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "monitor");

  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true });
  }, [activeTab, setSearchParams]);

  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader title="LLM 管理" subtitle="LLM 调用监控、接口配置、密钥凭证、连通性检查与 Prompt 模板管理" icon={Activity} />

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "monitor" && <MonitorTab />}
      {activeTab === "prompts" ? <PromptManagementTab /> : <ApiManagementTab activeSubTab={activeTab} hideSubTabs />}
    </Layout>
  );
}
