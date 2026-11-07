import { ActionIcon, Button, Group, Loader, Menu } from "@mantine/core";
import { IconChevronDown, IconDownload } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { api } from "@/api/client";
import { downloadBlobResponse } from "@/api/download";
import { toast } from "@/components/Toast";

interface ExportButtonProps {
	endpoint: string;
	/** 服务端未给文件名时的兜底名（扩展名按所选格式补） */
	filename: string;
	params?: Record<string, unknown>;
	/** 导出端点的方法：默认 POST（与列表筛选一致）；成本等只读端点是 GET */
	method?: "post" | "get";
}

export default function ExportButton({ endpoint, filename, params, method = "post" }: ExportButtonProps) {
	const [format, setFormat] = useState<"csv" | "xlsx">("csv");
	const [exporting, setExporting] = useState(false);

	const doExport = useCallback(
		async (fmt: string) => {
			setExporting(true);
			try {
				const sp = new URLSearchParams();
				if (params) for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
				sp.set("format", fmt);
				const config = { params: sp, responseType: "blob" as const };
				const resp =
					method === "get"
						? await api.get<Blob>(endpoint, config)
						: await api.post<Blob>(endpoint, null, config);
				downloadBlobResponse(resp, `${filename}.${fmt}`);
			} catch (e) {
				// 超限（400）、无权限（403）、网络错误都必须让用户看见；
				// 静默失败会让"导出没反应"变成无法自查的问题。
				toast.apiError(e, "导出失败");
			} finally {
				setExporting(false);
			}
		},
		[endpoint, filename, params, method],
	);

	return (
		<Group gap={2} wrap="nowrap">
			{/* 导出是工具栏动作，不是页面主行动：一屏唯一 filled 留给「新建 X」/「开始」。
			    这里统一用 default，避免每个用到导出的页面各写一遍层级。 */}
			<Button variant="default" size="sm" onClick={() => doExport(format)} disabled={exporting}>
				{exporting ? <Loader size={14} style={{ marginRight: 4 }} /> : <IconDownload size={14} style={{ marginRight: 4 }} />}
				{exporting ? "导出中..." : "导出"}
			</Button>
			<Menu width={112} position="bottom-end">
				<Menu.Target>
					<ActionIcon variant="default" size="sm" disabled={exporting} aria-label="选择导出格式">
						<IconChevronDown size={14} />
					</ActionIcon>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Item
						rightSection={format === "csv" ? <IconDownload size={12} /> : undefined}
						onClick={() => {
							setFormat("csv");
							doExport("csv");
						}}
					>
						.CSV
					</Menu.Item>
					<Menu.Item
						rightSection={format === "xlsx" ? <IconDownload size={12} /> : undefined}
						onClick={() => {
							setFormat("xlsx");
							doExport("xlsx");
						}}
					>
						.XLSX
					</Menu.Item>
				</Menu.Dropdown>
			</Menu>
		</Group>
	);
}
