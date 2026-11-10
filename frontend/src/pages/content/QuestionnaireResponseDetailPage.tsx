import {
	Anchor,
	Badge,
	Button,
	Divider,
	Group,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { IconClipboardList, IconExternalLink, IconUser } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import {
	getQuestionnaireResponse,
	type QuestionnaireAnswerItem,
} from "@/api/questionnaires";
import {
	QUESTION_TYPE_LABELS,
	RESPONSE_STATUS_LABEL,
	TRIGGER_EVENT_LABEL,
} from "@/components/admin/questionnaires/types";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { formatDateTime } from "@/utils/date";

const LIKERT_LABELS: Record<string, string> = {
	"1": "1 · 很不满意",
	"2": "2 · 不太满意",
	"3": "3 · 一般",
	"4": "4 · 比较满意",
	"5": "5 · 非常满意",
};

/**
 * 单题答案的呈现：值 → 人话（量表分值带刻度说明），未作答显式说出来。
 *
 * 留在组件里而不是渲染时内联：它要同时处理「空 / 量表 / 自由文本」三种形态，
 * 内联进 map 会把详情页的主体结构埋进三层三元表达式。
 */
function AnswerValue({ answer }: { answer: QuestionnaireAnswerItem }) {
	const raw = answer.answer_value;
	const blank = raw === null || raw === undefined || raw.trim() === "";
	if (blank) {
		return (
			<Text size="sm" c="dimmed" fs="italic">
				{answer.required ? "未作答（必答题）" : "未作答（选答题）"}
			</Text>
		);
	}
	if (answer.question_type === "likert_5" || answer.question_type === "satisfaction_5") {
		return (
			<Group gap={8} align="baseline">
				<Badge variant="light" color="blue">
					{LIKERT_LABELS[raw.trim()] ?? raw}
				</Badge>
			</Group>
		);
	}
	return (
		<Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
			{raw}
		</Text>
	);
}

/**
 * `/admin/questionnaires/:id/responses/:responseId`
 *
 * 单份答卷：作答人、触发时点、提交时间、全部题目答案，以及能跳到关联训练记录的入口。
 * 越权（他校/他人名下）后端返回 404，这里照实呈现为「不存在或无权访问」——
 * 不做半截渲染，也不把 404 说成"没有答案"。
 */
export default function QuestionnaireResponseDetailPage() {
	const { id, responseId } = useParams<{ id: string; responseId: string }>();
	const templateId = Number(id);
	const rid = Number(responseId);
	const valid = Number.isInteger(templateId) && templateId > 0 && Number.isInteger(rid) && rid > 0;
	const navigate = useNavigate();

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.questionnaires.response(valid ? templateId : null, valid ? rid : null),
		queryFn: () => getQuestionnaireResponse(templateId, rid).then((r) => r.data),
		enabled: valid,
		staleTime: 60_000,
	});

	const backToList = () => navigate(`/admin/questionnaires/${templateId}/responses`);

	if (!valid) {
		return (
			<ErrorState
				title="答卷地址无效"
				description="地址栏里的问卷或答卷编号不是一个有效编号。"
			/>
		);
	}

	if (isLoading) {
		return (
			<Stack gap="md">
				<PageHeader
					title="答卷详情"
					icon={IconClipboardList}
					backTo={`/admin/questionnaires/${templateId}/responses`}
				/>
				<LoadingSkeleton variant="stats" message="加载答卷..." />
			</Stack>
		);
	}

	if (isError || !data) {
		return (
			<Stack gap="md">
				<PageHeader
					title="答卷详情"
					icon={IconClipboardList}
					backTo={`/admin/questionnaires/${templateId}/responses`}
				/>
				<ErrorState
					title="答卷不存在或无权访问"
					error={error}
					onRetry={() => refetch()}
				/>
				<Button variant="subtle" onClick={backToList} style={{ alignSelf: "flex-start" }}>
					返回答卷列表
				</Button>
			</Stack>
		);
	}

	const answeredCount = data.answers.filter(
		(a) => a.answer_value != null && a.answer_value.trim() !== "",
	).length;

	return (
		<Stack gap="md">
			<PageHeader
				title={`${data.user_name || `用户 #${data.user_id}`} 的答卷`}
				subtitle={`${data.template_title || "问卷"} · 完成 ${answeredCount}/${data.answers.length} 题`}
				icon={IconClipboardList}
				backTo={`/admin/questionnaires/${templateId}/responses`}
			/>

			<Paper withBorder p="md">
				<Stack gap="sm">
					<Group gap={8}>
						<IconUser size={16} />
						<Text fw={600} size="sm">
							作答人
						</Text>
						<Text size="sm">{data.user_name || `用户 #${data.user_id}`}</Text>
					</Group>

					<Group gap="lg" wrap="wrap">
						<Group gap={6}>
							<Text size="xs" c="dimmed">
								触发时点
							</Text>
							<Badge variant="light" color={data.trigger_event === "after_scoring" ? "grape" : "blue"}>
								{TRIGGER_EVENT_LABEL[data.trigger_event] ?? data.trigger_event}
							</Badge>
						</Group>
						<Group gap={6}>
							<Text size="xs" c="dimmed">
								状态
							</Text>
							<Badge variant="light" color={data.status === "completed" ? "green" : "gray"}>
								{RESPONSE_STATUS_LABEL[data.status] ?? data.status}
							</Badge>
						</Group>
						<Group gap={6}>
							<Text size="xs" c="dimmed">
								提交时间
							</Text>
							<Text size="sm" className="tabular-nums">
								{data.completed_at ? formatDateTime(data.completed_at) : "未提交"}
							</Text>
						</Group>
						{data.case_name && (
							<Group gap={6}>
								<Text size="xs" c="dimmed">
									病例
								</Text>
								<Text size="sm">{data.case_name}</Text>
							</Group>
						)}
					</Group>

					{/* 只有真实 record id 才给入口：没有关联记录时说明原因，而不是留一个死链 */}
					{data.record_id ? (
<Anchor
						component={Link}
						to={`/admin/records/${data.record_id}`}
						size="sm"
					>
							<Group gap={4} wrap="nowrap" component="span">
								<IconExternalLink size={14} />
								查看关联训练记录 #{data.record_id}
							</Group>
						</Anchor>
					) : (
						<Text size="xs" c="dimmed">
							该答卷在训练前提交，没有关联的训练记录。
						</Text>
					)}
				</Stack>
			</Paper>

			<Paper withBorder p="md">
				<Title order={2} mb="sm">
					作答内容
				</Title>
				{data.answers.length === 0 ? (
					<Text size="sm" c="dimmed">
						这份答卷没有任何答案记录。
					</Text>
				) : (
					<Stack gap="md">
						{data.answers.map((a, index) => (
							<div key={a.question_id}>
								{index > 0 && <Divider mb="md" />}
								<Group gap={8} mb={6} align="flex-start" wrap="nowrap">
									<Badge variant="light" color="gray" size="sm">
										{QUESTION_TYPE_LABELS[a.question_type] ?? a.question_type}
									</Badge>
									<Text size="sm" fw={600} style={{ wordBreak: "break-word" }}>
										{index + 1}. {a.question_content || `题目 #${a.question_id}`}
									</Text>
									{!a.required && (
										<Badge variant="outline" color="gray" size="xs">
											选答
										</Badge>
									)}
								</Group>
								<AnswerValue answer={a} />
								{/* 多选题把可选项一并列出：只显示选中的那一项，读者无法判断"漏选"还是"没这个选项" */}
								{a.question_type === "multiple_choice" && a.options && a.options.length > 0 && (
									<Text size="xs" c="dimmed" mt={4}>
										可选：{a.options.join(" / ")}
									</Text>
								)}
							</div>
						))}
					</Stack>
				)}
			</Paper>

			<Group>
				<Button variant="default" onClick={backToList}>
					返回答卷列表
				</Button>
				<Button
					variant="light"
					onClick={() => navigate(`/admin/questionnaires/${templateId}/stats`)}
				>
					查看统计
				</Button>
			</Group>
		</Stack>
	);
}
