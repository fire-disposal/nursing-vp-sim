import { Badge, Group, Text } from "@mantine/core";
import { CASE_STATUS_META, caseStatusLabel } from "./caseStatus";

interface CaseStatusBadgeProps {
	status: string | null | undefined;
	/** 当前 revision 号；未发布（无版本）时不显示。 */
	revisionNo?: number | null;
	size?: "xs" | "sm" | "md";
}

/** 生命周期徽章：草稿 / 已发布 vN / 已归档。 */
export function CaseStatusBadge({ status, revisionNo, size = "xs" }: CaseStatusBadgeProps) {
	const meta = status ? CASE_STATUS_META[status] : undefined;
	return (
		<Group gap={4} wrap="nowrap">
			<Badge variant="light" color={meta?.color ?? "gray"} size={size}>
				{caseStatusLabel(status)}
			</Badge>
			{revisionNo != null && (
				<Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
					v{revisionNo}
				</Text>
			)}
		</Group>
	);
}
