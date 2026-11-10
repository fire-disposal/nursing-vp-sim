import { Stack, Text } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { getQuestionnaireTemplate } from "@/api/questionnaires";
import QuestionnaireStats from "@/components/admin/questionnaires/QuestionnaireStats";
import ErrorState from "@/components/ui/error-state";
import PageHeader from "@/components/ui/page-header";

/**
 * `/admin/questionnaires/:id/stats`
 *
 * 统计是一个**真实页面**：可以直接打开链接、刷新、前进/后退，
 * 「返回列表」走路由而不是翻转某个 boolean。
 */
export default function QuestionnaireStatsPage() {
	const { id } = useParams<{ id: string }>();
	const templateId = Number(id);
	const valid = Number.isInteger(templateId) && templateId > 0;

	// 模板标题/启用状态用于页头副标题；统计本体由子组件自己取数（两者失败互不牵连）。
	const { data: template } = useQuery({
		queryKey: queryKeys.questionnaires.detail(valid ? templateId : null),
		queryFn: () => getQuestionnaireTemplate(templateId).then((r) => r.data),
		enabled: valid,
		staleTime: 5 * 60_000,
	});

	if (!valid) {
		return <ErrorState title="问卷 ID 无效" description="地址栏里的问卷 ID 不是一个有效编号。" />;
	}

	return (
		<Stack gap="md">
			<PageHeader
				title={template?.title ? `${template.title} · 数据统计` : "问卷数据统计"}
				subtitle="回收情况与各题分布；可下钻到逐份答卷"
				icon={IconChartBar}
				backTo="/admin/questionnaires"
			/>
			{template && (
				<Text size="xs" c="dimmed">
					{template.question_count} 道题 · 已回收 {template.response_count} 份
				</Text>
			)}
			<QuestionnaireStats key={templateId} templateId={templateId} />
		</Stack>
	);
}
