import { Activity, Award, BarChart3, Cpu, Palette } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import ApiManagementTab from "@/components/teacher/ApiManagementTab";
import MonitorTab from "@/components/teacher/MonitorTab";
import PromptManagementTab from "@/components/teacher/PromptManagementTab";
import RubricTab from "@/components/teacher/RubricTab";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";

const TABS = [
  { key: "monitor", icon: BarChart3, label: "调用监控" },
  { key: "api", icon: Cpu, label: "API 管理" },
  { key: "prompts", icon: Palette, label: "Prompt 管理" },
  { key: "rubrics", icon: Award, label: "评分标准" },
];

export default function LLMManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "monitor";
  const setTab = (t: string) => setSearchParams({ tab: t }, { replace: true });

  return (
    <>
      <PageHeader title="LLM 管理" subtitle="调用监控 · API 密钥与用途配置 · Prompt 模板管理 · 评分标准管理" icon={Activity} />
      <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />
      {tab === "monitor" && <MonitorTab />}
      {tab === "api" && <ApiManagementTab />}
      {tab === "prompts" && <PromptManagementTab />}
      {tab === "rubrics" && <RubricTab />}
    </>
  );
}
