import { Badge, Button, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { IconArrowsExchange, IconRefresh } from "@tabler/icons-react";
import type { PracticeKind, PracticeMarker, PracticeOptions } from "./record-view";

interface Props {
	/** 本记录自身的练习留痕（非空 = 本次就是某次复盘后的再练习） */
	practice: PracticeMarker | null;
	/** 服务端解析出的再练习入口（不可用的不渲染） */
	options: PracticeOptions | null;
	/** 正在发起的入口类型（用于按钮 loading），null = 空闲 */
	starting: PracticeKind | null;
	onStart: (kind: PracticeKind) => void;
}

/**
 * 再练习入口 —— 只渲染服务端 `available=true` 的入口。
 *
 * 前端不猜目标病例、不自行拼 case_id：点击只表达意图（kind），目标病例、钉住的 revision
 * 与「内容是否已更新」全部由服务端解析并留痕。两个入口都不可用时**整块不渲染**
 * （不给假入口，也不给 disabled 的摆设）。
 */
export default function PracticeSection({ practice, options, starting, onStart }: Props) {
	const entries = (["remediation", "transfer"] as const)
		.map((kind) => ({ kind, option: options?.[kind] }))
		.filter((entry): entry is { kind: PracticeKind; option: NonNullable<PracticeOptions["remediation"]> } =>
			entry.option?.available === true,
		);

	if (!practice && entries.length === 0) return null;

	return (
		<Paper withBorder p={{ base: "md", sm: "lg" }}>
			<Stack gap="sm">
				<Group gap={8} wrap="nowrap">
					<IconRefresh size={18} />
					<Title order={3} size="md">
						再练习
					</Title>
					{practice && (
						<Badge variant="light" color="brand" size="sm">
							{practice.purpose || (practice.kind === "transfer" ? "变式迁移练习" : "同例纠正练习")}
							{practice.source_record_id != null && ` · 源自 #${practice.source_record_id}`}
						</Badge>
					)}
				</Group>

				{practice && (
					<Text size="xs" c="dimmed">
						本次记录本身即为{practice.kind === "transfer" ? "变式迁移" : "同例纠正"}练习
						{practice.revision_changed
							? "；开始练习时病例内容已更新，使用的是当时的最新版本"
							: ""}
					</Text>
				)}

				{entries.length > 0 && (
					<Stack gap="xs">
						{entries.map(({ kind, option }) => (
							<Group key={kind} justify="space-between" align="center" wrap="wrap" gap="sm">
								<Stack gap={2} style={{ minWidth: 0 }}>
									<Text size="sm" fw={600}>
										{option.label}
									</Text>
									<Text size="xs" c="dimmed">
										{option.case_name ? `目标病例：${option.case_name}` : option.message || ""}
									</Text>
								</Stack>
								<Button
									variant={kind === "remediation" ? "filled" : "outline"}
									color="brand"
									size="sm"
									disabled={starting !== null}
									onClick={() => onStart(kind)}
								>
									{starting === kind ? (
										<Loader size="xs" color="white" />
									) : (
										<IconArrowsExchange size={14} />
									)}
									{/* 内容已更新必须写在按钮上：不能悄悄换成新版本却声称"同一任务" */}
									{option.revision_changed ? `${option.label}（病例内容已更新）` : option.label}
								</Button>
							</Group>
						))}
					</Stack>
				)}
			</Stack>
		</Paper>
	);
}
