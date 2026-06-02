import { Users } from "lucide-react";
import useAuthStore from "@/stores/authStore";
import Layout from "@/components/Layout";
import UsersTab from "@/components/teacher/UsersTab";
import PageHeader from "@/components/ui/PageHeader";

export default function UsersPage() {
  const userId = useAuthStore((s) => s.user?.user_id);
  return (
    <Layout>
      <PageHeader title="用户管理" subtitle="搜索、注册、编辑和管理所有用户账号" icon={Users} />
      <UsersTab currentUserId={userId} />
    </Layout>
  );
}
