import { UserSearch } from "lucide-react";
import Layout from "../../components/Layout";
import CasesTab from "../../components/teacher/CasesTab";
import PageHeader from "../../components/ui/PageHeader";

export default function CasesPage({ user, onLogout }) {
  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader title="病例管理" subtitle="创建、编辑和管理虚拟患者病例库" icon={UserSearch} />
      <CasesTab />
    </Layout>
  );
}
