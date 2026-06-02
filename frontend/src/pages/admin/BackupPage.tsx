import { Database } from "lucide-react";
import Layout from "../../components/Layout";
import BackupTab from "../../components/teacher/BackupTab";
import PageHeader from "../../components/ui/PageHeader";

export default function BackupPage() {
  return (
    <Layout>
      <PageHeader title="备份管理" subtitle="下载数据库备份文件，用于数据安全与迁移" icon={Database} />
      <BackupTab />
    </Layout>
  );
}
