import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { useState } from "react";
import { getSystemConfigs, updateSystemConfig } from "@/api/admin/system-configs";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/error-utils";

export default function SystemConfigsPage() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<Record<string, string>>({});
	const [savingKey, setSavingKey] = useState<string | null>(null);

	const { data, isLoading } = useQuery({
		queryKey: ["system-configs"],
		queryFn: () => getSystemConfigs().then((r) => r.data),
	});

	const handleSave = async (key: string) => {
		setSavingKey(key);
		try {
			await updateSystemConfig(key, editing[key] ?? "");
			toast.success("配置已更新");
			queryClient.invalidateQueries({ queryKey: ["system-configs"] });
		} catch (e) {
			toast.error(getApiErrorMessage(e, "更新失败"));
		} finally {
			setSavingKey(null);
		}
	};

	const configs = data ?? [];

	return (
		<div className="space-y-6">
			<PageHeader title="系统配置" subtitle="管理后端运行时配置项" />
			{isLoading ? (
				<LoadingSkeleton variant="card" />
			) : configs.length === 0 ? (
				<EmptyState icon={Settings2} title="暂无配置项" />
			) : (
				<div className="rounded-xl border bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>配置项</TableHead>
								<TableHead>说明</TableHead>
								<TableHead>值</TableHead>
								<TableHead className="w-20" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{configs.map((c) => (
								<TableRow key={c.key}>
									<TableCell className="font-mono text-sm">
										{c.key}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{c.description}
									</TableCell>
									<TableCell>
										<input
											type="text"
											className="w-full rounded-md border px-2.5 py-1.5 text-sm"
											value={editing[c.key] ?? c.value ?? ""}
											onChange={(e) =>
												setEditing((prev) => ({
													...prev,
													[c.key]: e.target.value,
												}))
											}
										/>
									</TableCell>
									<TableCell>
										<Button
											size="sm"
											onClick={() => handleSave(c.key)}
											disabled={savingKey === c.key}
										>
											<Settings2 className="size-3.5" />
											{savingKey === c.key ? "保存中..." : "保存"}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
