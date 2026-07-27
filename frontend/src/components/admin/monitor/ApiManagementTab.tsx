import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus } from "lucide-react";
import { useState } from "react";
import {
	deleteSecret,
	fetchEnvFallback,
	fetchSecrets,
	testAllSecrets,
} from "@/api";
import type { ApiSecretResponse } from "@/api/admin/api-management-types";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import SecretList from "./SecretList";
import SecretModal from "./SecretModal";

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
	const { data: envFallback } = useQuery({
		queryKey: queryKeys.apiManagement.fallback,
		queryFn: () => fetchEnvFallback().then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.apiManagement.secrets });
	};

	const handleDeleteSecret = async (s: ApiSecretResponse) => {
		if (
			!(await confirm({
				title: "删除密钥",
				message: `删除 "${s.label}"？`,
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
			const r = await testAllSecrets();
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
				{envFallback?.available && (
					<div className="mb-3 px-3 py-2 text-xs rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
						当前 LLM 来源：环境变量 (sk-...{envFallback.key_suffix})。
						数据库密钥已全部停用，添加新密钥后将自动切换。
					</div>
				)}
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
