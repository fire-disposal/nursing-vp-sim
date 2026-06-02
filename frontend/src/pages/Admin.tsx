import { Settings } from "lucide-react";
import Layout from "@/components/Layout";
import QARecordsTab from "@/components/teacher/QARecordsTab";
import PageHeader from "@/components/ui/PageHeader";

export default function Admin() {
  return (
    <Layout>
      <PageHeader title="训练管理" subtitle="查看学生问答记录" icon={Settings} />
      <QARecordsTab />
    </Layout>
  );
}
