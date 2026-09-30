import { APP_TIME_ZONE, shanghaiDateKey, shanghaiHour } from "@/utils/date";
import { Group, Paper, Progress, SegmentedControl, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  IconChartBar,
  IconClipboardList,
  IconTarget,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRecords, getRecordsSummary } from "@/api";
import { getAssignments } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { getTeacherSummary } from "@/api/stats";
import StatCard from "@/components/ui/stat-card";
import useAuthStore from "@/stores/authStore";
import { ActivityTimeline, type ActivityEvent } from "./ActivityTimeline";
import { AssignmentOverview } from "./AssignmentOverview";
import { TrainingTrend } from "./TrainingTrend";

const SCORE_COLOR = (s: number): ActivityEvent["metaColor"] =>
  s >= 85 ? "green" : s >= 60 ? "amber" : "red";

// 分析周期的候选窗口：`days` = 含今天在内的上海自然日天数，0 = 不限下界。
const PERIODS = [
  { value: "week", label: "近7天", days: 7 },
  { value: "month", label: "近30天", days: 30 },
  { value: "all", label: "全部", days: 0 },
] as const;

// 待批阅只要 total（筛选条件与训练记录页同一套），列表由那一页展示。
const PENDING_REVIEW_PARAMS: Record<string, unknown> = { review_status: "pending", limit: 1 };
// 作业完成率的分母是发布时固化的受众快照；status=active 的判定与 AssignmentOverview 的客户端过滤同规则。
const ACTIVE_ASSIGNMENT_PARAMS: Record<string, unknown> = { status: "active", limit: 200 };

/**
 * 教学看板。
 *
 * **数字一律来自"列表的聚合视图"**（`/training/records/summary`）——同一份筛选参数既算 KPI
 * 又拼下钻链接，所以"卡片上的数字"与"点进去的首屏"由构造保证一致，不靠人工对账。
 * 看板自己不再有"今天/本周"这类后端概念：时间窗在下面按上海自然日算好后显式传出去。
 */
export function TeachingDashboard() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<string>("month");

  // 上海自然日的当前窗口与"今天"：日期运算交给 shanghaiDateKey（在上海日历上做），
  // 这里只拼 `+08:00` —— 不手写时区偏移算术。
  const scope = useMemo(() => {
    const preset = PERIODS.find((p) => p.value === period) ?? PERIODS[2];
    const dateFrom =
      preset.days > 0 ? `${shanghaiDateKey(new Date(), 1 - preset.days)}T00:00:00+08:00` : undefined;
    return {
      label: preset.label,
      dateFrom,
      recordsHref: dateFrom
        ? `/admin/records?date_from=${encodeURIComponent(dateFrom)}`
        : "/admin/records",
    };
  }, [period]);

  const todayFrom = `${shanghaiDateKey()}T00:00:00+08:00`;
  const todayHref = `/admin/records?date_from=${encodeURIComponent(todayFrom)}`;
  const scopedParams = useMemo(
    () => (scope.dateFrom ? { date_from: scope.dateFrom } : {}),
    [scope.dateFrom],
  );

  // 今日两个 KPI 共用同一次统计：一次请求、一个作用域，不可能互相矛盾。
  const { data: todaySummary } = useQuery({
    queryKey: queryKeys.training.recordsSummary({ date_from: todayFrom }),
    queryFn: () => getRecordsSummary({ date_from: todayFrom }).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: pendingSummary } = useQuery({
    queryKey: queryKeys.training.recordsSummary(PENDING_REVIEW_PARAMS),
    queryFn: () => getRecordsSummary(PENDING_REVIEW_PARAMS).then((r) => r.data),
    staleTime: 30_000,
  });

  // 随周期变化的窗口：平均得分 / 平均训练时长与它们的下钻列表共用 scopeParams。
  const { data: scopedSummary } = useQuery({
    queryKey: queryKeys.training.recordsSummary(scopedParams),
    queryFn: () => getRecordsSummary(scopedParams).then((r) => r.data),
    staleTime: 60_000,
  });

  // 与 AssignmentOverview 共用同一次查询，作业完成率因此和下方列表同源。
  const { data: assignmentsData } = useQuery({
    queryKey: queryKeys.assignments.admin(),
    queryFn: () => getAssignments(ACTIVE_ASSIGNMENT_PARAMS).then((r) => r.data),
    staleTime: 60_000,
  });

  // 总学生与下方「学生训练量」表同源：teacher_summary 走 outerjoin，含从没训练过的学生，
  // 且只要 stats_view（= 本页门禁）。**不能用 `/admin/users?role=student`** —— 那个端点
  // 要求 user_manage，教师没有该权限，会把人数静默显示成 0。
  const { data: studentCountData } = useQuery({
    queryKey: queryKeys.stats.teacherSummary({ offset: 0, limit: 1 }),
    queryFn: () => getTeacherSummary({ offset: 0, limit: 1 }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // limit=10 只服务页面底部的"最近训练动态"时间线，KPI 不从这份样本里派生。
  const { data: recordsData } = useQuery({
    queryKey: queryKeys.training.records({ limit: 10 }),
    queryFn: () => getRecords({ limit: 10 }).then((r) => r.data),
    staleTime: 30_000,
  });

  const records = recordsData?.items ?? [];
  const activeAssignments = assignmentsData?.items ?? [];

  const todayRecords = todaySummary?.total ?? 0;
  const todayStudents = todaySummary?.students ?? 0;
  const pendingTotal = pendingSummary?.total ?? 0;
  const avgScore = scopedSummary?.avg_score;
  const avgDuration = scopedSummary?.avg_duration_min;
  const totalStudents = studentCountData?.total ?? 0;

  // 作业完成率 = sum(已完成人数) / sum(受众快照人数)：分母是发布时固化的人数，
  // 不是"在校学生总数"，所以退课/新入班都不会让比率失真。
  const audienceTotal = activeAssignments.reduce((sum, a) => sum + a.student_count, 0);
  const completedTotal = activeAssignments.reduce((sum, a) => sum + a.completed_count, 0);
  const assignmentRate = audienceTotal > 0 ? Math.round((completedTotal / audienceTotal) * 100) : 0;

  const hour = shanghaiHour();
  const greeting = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  const recentEvents: ActivityEvent[] = records.slice(0, 8).map((r) => ({
    id: r.id,
    time: new Date(r.start_time).toLocaleTimeString("zh-CN", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit" }),
    studentName: r.user_display_name ?? "未知",
    action: r.status === "completed" ? `完成了 ${r.case_name ?? "训练"}` : "开始了训练",
    meta: r.score_total != null ? `${r.score_total}分` : undefined,
    metaColor: r.score_total != null ? SCORE_COLOR(r.score_total) : undefined,
  }));

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={1} size="xl" fw={700}>
            {greeting}，{user?.display_name || "老师"}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            {new Date().toLocaleDateString("zh-CN", {
              timeZone: APP_TIME_ZONE,
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Text>
        </div>
        {/* 周期同时决定「平均得分/平均训练时长」两个 KPI 的作用域与下方趋势图的窗口，
            所以放在头部而不是只贴在图上：改了它，上面的数字跟着变。 */}
        <SegmentedControl
          aria-label="统计周期"
          data={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          value={period}
          onChange={setPeriod}
        />
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <StatCard
          icon={IconUsers}
          value={todayStudents}
          label="今日活跃学生"
          color="blue"
          onClick={todayStudents > 0 ? () => navigate(todayHref) : undefined}
        />
        <StatCard
          icon={IconTrendingUp}
          value={todayRecords}
          label="今日训练次数"
          color="blue"
          onClick={todayRecords > 0 ? () => navigate(todayHref) : undefined}
        />
        <StatCard
          icon={IconTarget}
          value={avgScore != null ? `${avgScore}分` : "--"}
          label={`平均得分（${scope.label}）`}
          color={avgScore == null ? "blue" : avgScore >= 80 ? "green" : avgScore >= 60 ? "amber" : "red"}
          onClick={
            scopedSummary && scopedSummary.total > 0 ? () => navigate(scope.recordsHref) : undefined
          }
        />
        <StatCard
          icon={IconClipboardList}
          value={pendingTotal}
          label="待批阅训练"
          color={pendingTotal > 5 ? "red" : "green"}
          onClick={pendingTotal > 0 ? () => navigate("/admin/records?review_status=pending") : undefined}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
        <Paper
          withBorder
          p="md"
          onClick={activeAssignments.length > 0 ? () => navigate("/admin/assignments?status=active") : undefined}
          style={{ cursor: activeAssignments.length > 0 ? "pointer" : undefined }}
        >
          <Stack gap={4} justify="center" style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" mb={4}>作业完成率</Text>
            <Group align="flex-end" gap={6}>
              <Text size="xl" fw={700}>{assignmentRate}%</Text>
              <Text size="xs" c="dimmed">{completedTotal}/{audienceTotal} 人</Text>
            </Group>
            <Progress value={assignmentRate} size="sm" radius="md" mt={8} />
          </Stack>
        </Paper>
        <Paper
          withBorder
          p="md"
          onClick={
            scopedSummary && scopedSummary.total > 0 ? () => navigate(scope.recordsHref) : undefined
          }
          style={{ cursor: scopedSummary && scopedSummary.total > 0 ? "pointer" : undefined }}
        >
          <Stack gap={4} justify="center" style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" mb={4}>平均训练时长（{scope.label}）</Text>
            <Group align="flex-end" gap={6}>
              <Text size="xl" fw={700}>{avgDuration != null ? avgDuration : "--"}</Text>
              {avgDuration != null && <Text size="xs" c="dimmed">分钟</Text>}
            </Group>
          </Stack>
        </Paper>
        <Paper withBorder p="md">
          <Stack gap={4} justify="center" style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" mb={4}>总学生</Text>
            <Group align="flex-end" gap={6}>
              <Text size="xl" fw={700}>{totalStudents}</Text>
              <Text size="xs" c="dimmed">人</Text>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>

      <TrainingTrend dateFrom={scope.dateFrom} />

      <AssignmentOverview assignments={activeAssignments} />

      <Paper withBorder p="md">
        <Group gap={8} mb={8}>
          <IconChartBar size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
          <Text size="sm" fw={500}>最近训练动态</Text>
        </Group>
        <ActivityTimeline events={recentEvents} />
      </Paper>
    </Stack>
  );
}
