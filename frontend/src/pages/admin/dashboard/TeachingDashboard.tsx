import { Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconChartBar, IconClipboardList, IconTarget, IconTrendingUp, IconUsers } from "@tabler/icons-react";
import type { components } from "@/api/api-types.gen";
import { getAssignments } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { getRecords, getStats } from "@/api";
import StatCard from "@/components/ui/stat-card";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import { ActivityTimeline, type ActivityEvent } from "./ActivityTimeline";
import { AssignmentOverview } from "./AssignmentOverview";

type AdminStats = components["schemas"]["AdminStats"];
type AssignmentListItem = components["schemas"]["AssignmentListItem"];

const SCORE_COLOR = (s: number): ActivityEvent["metaColor"] =>
  s >= 85 ? "green" : s >= 60 ? "amber" : "red";

export function TeachingDashboard() {
  const user = useAuthStore((s) => s.user);

  const { data: stats } = useQuery({
    queryKey: queryKeys.stats.admin(),
    queryFn: () => getStats().then((r) => r.data as AdminStats),
    staleTime: 60_000,
  });

  const { data: recordsData } = useQuery({
    queryKey: queryKeys.training.records({ limit: 10 }),
    queryFn: () => getRecords({ limit: 10 }).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: queryKeys.assignments.admin(),
    queryFn: () => getAssignments().then((r) => r.data),
    staleTime: 60_000,
  });

  const records = (recordsData?.items ?? []) as RecordExtended[];
  const assignments = (assignmentsData?.items ?? []) as AssignmentListItem[];

  const completedRecords = records.filter((r: RecordExtended) => r.status === "completed");
  const todayRecords = records.filter((r: RecordExtended) => {
    const d = new Date(r.start_time);
    return d.toDateString() === new Date().toDateString();
  });
  const completedWeek = records.filter((r: RecordExtended) => {
    if (r.status !== "completed") return false;
    return new Date(r.start_time) >= new Date(Date.now() - 7 * 24 * 3600_000);
  });

  const totalStudents = stats?.total_students ?? 0;
  const activeStudentCount = new Set(todayRecords.map((r: RecordExtended) => r.user_display_name)).size;
  const pendingReview = completedRecords.filter(
    (r: RecordExtended) => !r.score_reviewed,
  ).length;
  const avgScore = stats?.average_score;
  const avgDuration = stats?.avg_duration_min;
  const completionRate = totalStudents > 0 ? Math.round((completedWeek.length / totalStudents) * 100) : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  const recentEvents: ActivityEvent[] = records.slice(0, 8).map((r: RecordExtended) => ({
    id: r.id,
    time: new Date(r.start_time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    studentName: r.user_display_name ?? "未知",
    action: r.status === "completed" ? `完成了 ${r.case_name ?? "训练"}` : "开始了训练",
    meta: r.score_total != null ? `${r.score_total}分` : undefined,
    metaColor: r.score_total != null ? SCORE_COLOR(r.score_total) : undefined,
  }));

  return (
    <Stack gap="xl">
      <div>
        <Title order={1} size="xl" fw={700}>
          {greeting}，{user?.display_name || "老师"}
        </Title>
        <Text size="sm" c="dimmed" mt={4}>
          本周截至 {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}
        </Text>
      </div>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <StatCard icon={IconUsers} value={activeStudentCount} label="今日活跃学生" color="blue" />
        <StatCard icon={IconTrendingUp} value={stats?.today_records ?? 0} label="今日训练次数" color="blue" />
        <StatCard
          icon={IconTarget}
          value={avgScore != null ? `${avgScore}分` : "--"}
          label="平均得分"
          color={avgScore != null && avgScore >= 80 ? "green" : avgScore != null && avgScore >= 60 ? "amber" : "red"}
        />
        <StatCard icon={IconClipboardList} value={pendingReview} label="待批阅训练" color={pendingReview > 5 ? "red" : "green"} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
        <Paper withBorder radius="md" p="md">
          <Stack gap={4} justify="center" style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" mb={4}>本周训练完成率</Text>
            <Group align="flex-end" gap={6}>
              <Text size="xl" fw={700}>{completionRate}%</Text>
              <Text size="xs" c="dimmed">{completedWeek.length}/{totalStudents} 人</Text>
            </Group>
            <Progress value={completionRate} size="sm" radius="md" mt={8} />
          </Stack>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Stack gap={4} justify="center" style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" mb={4}>平均训练时长</Text>
            <Group align="flex-end" gap={6}>
              <Text size="xl" fw={700}>{avgDuration != null ? avgDuration : "--"}</Text>
              {avgDuration != null && <Text size="xs" c="dimmed">分钟</Text>}
            </Group>
          </Stack>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Stack gap={4} justify="center" style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" mb={4}>总学生 / 总训练</Text>
            <Group align="flex-end" gap={6}>
              <Text size="xl" fw={700}>{totalStudents}</Text>
              <Text size="xs" c="dimmed">/ {stats?.total_records ?? 0}</Text>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>

      <AssignmentOverview assignments={assignments} />

      <Paper withBorder radius="md" p="md">
        <Group gap={8} mb={8}>
          <IconChartBar size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
          <Text size="sm" fw={500}>最近训练动态</Text>
        </Group>
        <ActivityTimeline events={recentEvents} />
      </Paper>
    </Stack>
  );
}
