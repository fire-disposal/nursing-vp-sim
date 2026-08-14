import { ActionIcon, Button, Group, Modal, Stack } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { createSecret, updateSecret } from "@/api";
import type { ApiSecretResponse } from "@/api/admin/api-management-types";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";

import { TextInput } from "@mantine/core";
import { type SecretFormValues, secretFormSchema } from "@/schemas/secret";

interface SecretModalProps {
	open: boolean;
	secret: ApiSecretResponse | null;
	onClose: () => void;
	onSaved: () => void;
}

export default function SecretModal({
	open,
	secret,
	onClose,
	onSaved,
}: SecretModalProps) {
	const { success, apiError } = useToast();
	const { confirm } = useConfirm();
	const isEdit = secret != null;
	const [showKey, setShowKey] = useState(false);

	const form = useForm<SecretFormValues>({
		initialValues: {
			label: "",
			baseUrl: "https://api.deepseek.com",
			rawKey: "",
			monthlyLimit: null,
			priority: 0,
			modelOverride: null,
		},
		validate: schemaResolver(secretFormSchema),
	});

	useEffect(() => {
		if (open) {
			form.setValues({
				label: secret?.label ?? "",
				baseUrl: secret?.base_url || "https://api.deepseek.com",
				rawKey: "",
				monthlyLimit: secret?.monthly_cost_limit ?? null,
				priority: secret?.priority ?? 0,
				modelOverride: secret?.model_override ?? null,
			});
			form.resetDirty();
			form.clearErrors();
		}
	}, [open, secret]);

	const onSubmit = async (values: SecretFormValues) => {
		if (!isEdit && !values.rawKey?.trim()) {
			form.setFieldError("rawKey", "创建时必须填写 API Key");
			return;
		}
		try {
			const common = {
				monthly_cost_limit: values.monthlyLimit,
				priority: values.priority,
				model_override: values.modelOverride ?? undefined,
			};
			if (isEdit) {
				await updateSecret(secret.id, {
					label: values.label.trim(),
					base_url: values.baseUrl?.trim() || "https://api.deepseek.com",
					...common,
				});
				success("密钥已更新");
			} else {
				await createSecret({
					label: values.label.trim(),
					raw_key: values.rawKey?.trim() ?? "",
					base_url: values.baseUrl?.trim() || "https://api.deepseek.com",
					// 与后端默认一致（price 默认 0.5），仅将隐式默认显式化
					price_input_per_1m: 0.5,
					price_output_per_1m: 0.5,
					...common,
				});
				success("密钥已创建");
			}
			onSaved();
			onClose();
		} catch (e: unknown) {
			apiError(e, "保存失败");
		}
	};
	const requestClose = async () => {
		if (form.isDirty()) {
			const ok = await confirm({ title: "关闭密钥编辑", message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		onClose();
	};

	return (
		<Modal
			opened={open}
			onClose={() => {
				void requestClose();
			}}
			title={isEdit ? "编辑密钥凭证" : "添加密钥凭证"}
			size={560}
			centered
			withinPortal
		>
				<form onSubmit={form.onSubmit(onSubmit)}>
					<Stack gap="sm">
						<TextInput
							label="标签" withAsterisk
							placeholder="如: DeepSeek 个人账号"
							{...form.getInputProps("label")}
						/>
						<TextInput
							label="API 端点 (Base URL)"
							placeholder="https://api.deepseek.com"
							{...form.getInputProps("baseUrl")}
						/>
						{!isEdit && (
							<TextInput
								label="API Key"
								type={showKey ? "text" : "password"}
								placeholder="sk-..."
								{...form.getInputProps("rawKey")}
								rightSection={
									<ActionIcon
										variant="subtle"
										color="gray"
										onClick={() => setShowKey((v) => !v)}
										aria-label={showKey ? "隐藏" : "显示"}
									>
										{showKey ? (
											<IconEyeOff size={16} />
										) : (
											<IconEye size={16} />
										)}
									</ActionIcon>
								}
							/>
						)}
						<TextInput
							label="月度预算上限 (¥, 留空不限制)"
							type="number"
							step="0.01"
							min="0"
							placeholder="如: 100.00"
							{...form.getInputProps("monthlyLimit")}
							value={form.values.monthlyLimit ?? ""}
							onChange={(e) =>
								form.setFieldValue(
									"monthlyLimit",
									e.currentTarget.value === ""
										? null
										: e.currentTarget.valueAsNumber,
								)
							}
						/>
						<TextInput
							label="优先级 (数字越大越优先)" withAsterisk
							type="number"
							step="1"
							min="0"
							{...form.getInputProps("priority")}
							onChange={(e) =>
								form.setFieldValue(
									"priority",
									e.currentTarget.value === ""
										? 0
										: e.currentTarget.valueAsNumber,
								)
							}
						/>
						<TextInput
							label="模型覆盖 (可选)"
							placeholder="如: deepseek-v4-pro"
							{...form.getInputProps("modelOverride")}
							value={form.values.modelOverride ?? ""}
							onChange={(e) =>
								form.setFieldValue("modelOverride", e.currentTarget.value || null)
							}
						/>
					</Stack>
				<Group justify="flex-end" mt="lg" gap="sm">
						<Button variant="outline" type="button" onClick={() => { void requestClose(); }}>
							取消
						</Button>
						<Button type="submit" disabled={form.submitting}>
							{form.submitting ? "保存中..." : "保存"}
						</Button>
				</Group>
				</form>
		</Modal>
	);
}
