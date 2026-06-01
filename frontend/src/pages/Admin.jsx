import { BarChart3, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import QARecordsTab from "../components/teacher/QARecordsTab";
import PageHeader from "../components/ui/PageHeader";
import Tabs from "../components/ui/Tabs";
import Stats from "./Stats";

const ADMIN_TABS = [
  { key: "stats", icon: BarChart3, label: "训练统计" },
  { key: "qa-records", label: "问答记录" },
];

export default function Admin({ user, onLogout }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "stats");

  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true });
  }, [activeTab, setSearchParams]);

  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader title="训练管理" subtitle="训练统计概览、用户管理与问答记录" icon={Settings} />

      <Tabs tabs={ADMIN_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "stats" && <Stats user={user} onLogout={onLogout} />}
      {activeTab === "qa-records" && <QARecordsTab />}
    </Layout>
  );
}
