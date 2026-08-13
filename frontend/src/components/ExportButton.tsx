import { ActionIcon, Group, Loader, Menu } from "@mantine/core";
import { IconChevronDown, IconDownload } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { api } from "@/api/client";
import Button from "@/components/ui/button";

interface ExportButtonProps {
	endpoint: string;
	filename: string;
	params?: Record<string, unknown>;
}

export default function ExportButton({ endpoint, filename, params }: ExportButtonProps) {
	const [format, setFormat] = useState<"csv" | "xlsx">("csv");
	const [exporting, setExporting] = useState(false);

	const doExport = useCallback(
		async (fmt: string) => {
			setExporting(true);
			try {
				const sp = new URLSearchParams();
				if (params) for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
				sp.set("format", fmt);
				const resp = await api.post<Blob>(endpoint, null, { params: sp, responseType: "blob" });
				const contentType = resp.headers["content-type"];
				const blob = new Blob([resp.data], {
					type: typeof contentType === "string" ? contentType : "application/octet-stream",
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `${filename}.${fmt}`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			} finally {
				setExporting(false);
			}
		},
		[endpoint, filename, params],
	);

	return (
		<Group gap={2} wrap="nowrap">
			<Button size="sm" onClick={() => doExport(format)} disabled={exporting}>
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
