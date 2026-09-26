import { Alert, Badge, Box, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";
import type { components } from "@/api/api-types.gen";

type CaseValidationReport = components["schemas"]["CaseValidationReport"];
type CaseValidationIssue = components["schemas"]["CaseValidationIssue"];

const SEVERITY_META: Record<
	"error" | "warning" | "info",
	{ label: string; color: string }
> = {
	error: { label: "必须修复", color: "red" },
	warning: { label: "警告", color: "yellow" },
	info: { label: "提示", color: "blue" },
};

function IssueGroup({
	severity,
	issues,
}: {
	severity: "error" | "warning" | "info";
	issues: CaseValidationIssue[];
}) {
	if (issues.length === 0) return null;
	const meta = SEVERITY_META[severity];
	return (
		<Stack gap={6}>
			<Group gap={6}>
				<Badge variant="light" color={meta.color} size="sm">
					{meta.label} {issues.length}
				</Badge>
			</Group>
			{issues.map((issue, index) => (
				<Box
					key={`${severity}-${index}-${issue.field}`}
					p="xs"
					style={{
						borderLeft: `3px solid var(--mantine-color-${meta.color}-5)`,
						background: "var(--mantine-color-default-hover)",
						borderRadius: 4,
					}}
				>
					{issue.field && (
						<Text size="xs" fw={600} style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
							{issue.field}
						</Text>
					)}
					<Text size="sm">{issue.message}</Text>
					{issue.fix_hint && (
						<Text size="xs" c="dimmed" mt={2}>
							修复建议：{issue.fix_hint}
						</Text>
					)}
				</Box>
			))}
		</Stack>
	);
}

/** 发布门禁报告：字段级 error / warning / info。 */
export default function CaseValidationReportView({ report }: { report: CaseValidationReport }) {
	const publishable = report.errors.length === 0;
	const quiet = publishable && report.warnings.length === 0 && report.infos.length === 0;
	return (
		<Stack gap="sm">
			<Alert
				variant="light"
				color={publishable ? "green" : "red"}
				icon={publishable ? <IconCircleCheck size={16} /> : <IconAlertTriangle size={16} />}
			>
				<Text size="sm">
					{publishable
						? quiet
							? "通过发布门禁，可以发布。"
							: "通过发布门禁，可以发布（下方提示项不阻止发布）。"
						: `未通过发布门禁：${report.errors.length} 个错误，修复后才能发布。`}
				</Text>
			</Alert>
			<IssueGroup severity="error" issues={report.errors} />
			<IssueGroup severity="warning" issues={report.warnings} />
			<IssueGroup severity="info" issues={report.infos} />
			{quiet && (
				<Group gap={4}>
					<IconInfoCircle size={14} color="var(--mantine-color-dimmed)" />
					<Text size="xs" c="dimmed">
						没有需要处理的校验项。
					</Text>
				</Group>
			)}
		</Stack>
	);
}
