/**
 * 编辑器「原始」页签：这份病例的 **TOML + MD 原文**，只读。
 *
 * 原文只有一处来源：后端的导出 zip（`case.toml` / `case.md` 就是它的原样产物）。
 * 前端**不再实现一套 TOML 生成/回写**——要改结构去「表单」，要离线改就先导出再导入。
 */

import { Alert, Button, Code, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCopy } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { toast } from "@/components/Toast";
import { getApiErrorDetail } from "@/utils/error";
import { caseFolderBytes } from "../transfer";
import { zipTextMembers } from "./zipMembers";

const FILES = ["case.toml", "case.md"];

export default function RawSource({ packKey }: { packKey: string }) {
	const source = useQuery({
		queryKey: queryKeys.scenario.admin.source(packKey),
		queryFn: async () => zipTextMembers(await caseFolderBytes(packKey), FILES),
		retry: false,
	});

	const copy = async (name: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`已复制 ${name}`);
		} catch {
			toast.error("复制失败，请手动选中后复制");
		}
	};

	if (source.isLoading) {
		return (
			<Stack align="center" py="xl">
				<Loader size="sm" />
			</Stack>
		);
	}
	if (source.isError || !source.data) {
		return (
			<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
				读这份病例的原文失败：{getApiErrorDetail(source.error, "请稍后重试")}
			</Alert>
		);
	}

	return (
		<Stack gap="md">
			<Text size="xs" c="dimmed">
				这是这份病例的原始文件（导出的 `case.toml` + `case.md`，只读）：TOML 只装机制与 meta，
				MD 只装散文。要改结构去「表单」页签；要离线改就先「导出」下载病例文件夹，改好再从列表页「导入」传回来。
			</Text>
			{FILES.map((name) => {
				const text = source.data[name];
				return (
					<Paper key={name} withBorder p="md">
						<Group justify="space-between" align="center" mb="xs">
							<Text fw={600}>{name}</Text>
							<Button
								size="compact-sm"
								variant="light"
								leftSection={<IconCopy size={14} />}
								disabled={text === undefined}
								onClick={() => text !== undefined && void copy(name, text)}
							>
								复制
							</Button>
						</Group>
						{text === undefined ? (
							<Text size="sm" c="red">
								导出的压缩包里没有这个文件。
							</Text>
						) : (
							<Code block style={{ maxHeight: 460, overflow: "auto" }}>
								{text}
							</Code>
						)}
					</Paper>
				);
			})}
		</Stack>
	);
}
