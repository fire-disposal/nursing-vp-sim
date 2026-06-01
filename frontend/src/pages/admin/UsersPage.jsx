import { Users } from "lucide-react";
import Layout from "../../components/Layout";
import UsersTab from "../../components/teacher/UsersTab";
import PageHeader from "../../components/ui/PageHeader";

export default function UsersPage({ user, onLogout }) {
  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader title="用户管理" subtitle="搜索、注册、编辑和管理所有用户账号" icon={Users} />
      <UsersTab currentUserId={user?.id} />
    </Layout>
  );
}
