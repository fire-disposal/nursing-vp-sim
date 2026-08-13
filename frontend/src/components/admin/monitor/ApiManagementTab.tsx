import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Group, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
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
	const [_testingAll, setTestingAll] = useState(false);

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

	const _handleTestAll = async () => {
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
			<Box mb="lg">
				<Group justify="space-between" mb="xs">
					<Text size="sm" fw={600}>API 密钥</Text>
					<Button
						size="sm"
						leftSection={<IconPlus size={14} />}
						onClick={() => {
							setEditingSecret(null);
							setShowSecretModal(true);
						}}
					>
						添加密钥
					</Button>
				</Group>
				{envFallback?.available && (
					<Alert color="green" variant="light" mb="sm">
						当前 LLM 来源：环境变量 (sk-...{envFallback.key_suffix})。
						数据库密钥已全部停用，添加新密钥后将自动切换。
					</Alert>
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
			</Box>

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
