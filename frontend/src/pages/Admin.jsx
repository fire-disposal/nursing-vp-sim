import { Settings } from "lucide-react";
import { useState } from "react";
import Layout from "../components/Layout";
import ApiManagementTab from "../components/teacher/ApiManagementTab";
import CasesTab from "../components/teacher/CasesTab";
import MonitorTab from "../components/teacher/MonitorTab";
import PromptManagementTab from "../components/teacher/PromptManagementTab";
import QARecordsTab from "../components/teacher/QARecordsTab";
import RecordsTab from "../components/teacher/RecordsTab";
import UsersTab from "../components/teacher/UsersTab";
import PageHeader from "../components/ui/PageHeader";
import Tabs from "../components/ui/Tabs";

const ADMIN_TABS = [
  { key: "records", label: "训练记录" },
  { key: "users", label: "用户管理" },
  { key: "cases", label: "病例管理" },
  { key: "monitor", label: "调用监控" },
  { key: "qa-records", label: "问答记录" },
  { key: "api", label: "API 管理" },
  { key: "prompts", label: "Prompt 管理" },
];

export default function Admin({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("records");

  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader title="管理后台" subtitle="教师管理面板：查看训练记录、管理用户与病例、监控 LLM 调用" icon={Settings} />

      <Tabs tabs={ADMIN_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "records" && <RecordsTab />}
      {activeTab === "users" && <UsersTab currentUserId={user?.id} />}
      {activeTab === "cases" && <CasesTab />}
      {activeTab === "monitor" && <MonitorTab />}
      {activeTab === "qa-records" && <QARecordsTab />}
      {activeTab === "api" && <ApiManagementTab />}
      {activeTab === "prompts" && <PromptManagementTab />}
    </Layout>
  );
}
