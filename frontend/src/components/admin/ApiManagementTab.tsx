import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus } from "lucide-react";
import { useState } from "react";
import {
	deleteSecret,
	fetchConfigs,
	fetchEnvFallback,
	fetchSecrets,
	testAllConfigs,
} from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import PurposeCardGrid from "./PurposeCardGrid";
import SecretList from "./SecretList";
import SecretModal from "./SecretModal";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];

export default function ApiManagementTab() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const [showSecretModal, setShowSecretModal] = useState(false);
	const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(null);
	const [testingAll, setTestingAll] = useState(false);

	const { data: secrets = [] } = useQuery({
		queryKey: queryKeys.apiManagement.secrets,
		queryFn: () => fetchSecrets().then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: configs = [] } = useQuery({
		queryKey: queryKeys.apiManagement.configs(),
		queryFn: () => fetchConfigs(undefined).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: envFallback } = useQuery({
		queryKey: queryKeys.apiManagement.fallback,
		queryFn: () => fetchEnvFallback().then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.apiManagement.secrets });
		void queryClient.invalidateQueries({ queryKey: queryKeys.apiManagement.configs() });
	};

	const handleDeleteSecret = async (s: ApiSecretResponse) => {
		if (
			!(await confirm({
				title: "删除密钥",
				message: `删除 "${s.label}"？${s.config_count && s.config_count > 0 ? ` 该密钥仍有 ${s.config_count} 个用途绑定。` : ""}`,
				danger: true,
			}))
		)
			return;
		try {
			await deleteSecret(s.id);
			toast.success("已删除");
			invalidate();
		} catch (e: unknown) {
			toast.apiError(e, "删除失败");
		}
	};

	const handleTestAll = async () => {
		setTestingAll(true);
		try {
			const r = await testAllConfigs();
			const results = r.data.results ?? [];
			const ok = results.filter((x) => x.ok).length;
			const fail = results.length - ok;
			if (fail === 0) {
				toast.success(`全部连通（${ok} 项）`);
			} else {
				toast.error(`成功 ${ok} · 失败 ${fail}`);
			}
		} catch {
			toast.error("测试失败");
		} finally {
			setTestingAll(false);
		}
	};

	return (
		<>
			<div className="mb-6">
				<div className="flex justify-between items-center mb-2">
					<h3 className="text-sm font-semibold text-foreground">API 密钥</h3>
					<div className="flex gap-2">
						<button
							onClick={handleTestAll}
							disabled={testingAll}
							className="inline-flex items-center gap-1 py-1 px-3 border border-border rounded-md bg-muted text-foreground cursor-pointer text-sm disabled:opacity-50"
						>
							<Activity size={14} /> {testingAll ? "测试中..." : "测试连通性"}
						</button>
						<button
							onClick={() => {
								setEditingSecret(null);
								setShowSecretModal(true);
							}}
							className="inline-flex items-center gap-1 py-1 px-3 border-none rounded-md bg-primary text-primary-foreground cursor-pointer text-sm"
						>
							<Plus size={14} /> 添加密钥
						</button>
					</div>
				</div>
				{secrets.length === 0 && !envFallback?.available ? (
					<EmptyState
						title="暂无密钥"
						description="添加 DeepSeek API Key 以开始使用"
					/>
				) : (
					<SecretList
						secrets={secrets}
						envFallback={envFallback}
						onEdit={(s) => {
							setEditingSecret(s);
							setShowSecretModal(true);
						}}
						onDelete={handleDeleteSecret}
					/>
				)}
			</div>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">用途配置</h3>
				<PurposeCardGrid
					configs={configs}
					secrets={secrets}
					onChanged={invalidate}
				/>
			</div>

			<SecretModal
				open={showSecretModal}
				secret={editingSecret}
				onClose={() => {
					setShowSecretModal(false);
					setEditingSecret(null);
				}}
				onSaved={invalidate}
			/>
		</>
	);
}
