import { zodResolver } from "@hookform/resolvers/zod";
import { ActionIcon, Stack } from "@mantine/core";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { createSecret, updateSecret } from "@/api";
import type { ApiSecretResponse } from "@/api/admin/api-management-types";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
		resolver: zodResolver(secretFormSchema),
		defaultValues: {
			label: "",
			baseUrl: "https://api.deepseek.com",
			rawKey: "",
			monthlyLimit: null,
			priority: 0,
			modelOverride: null,
		},
	});

	useEffect(() => {
		if (open) {
			form.reset({
				label: secret?.label ?? "",
				baseUrl: secret?.base_url || "https://api.deepseek.com",
				rawKey: "",
				monthlyLimit: secret?.monthly_cost_limit ?? null,
				priority: secret?.priority ?? 0,
				modelOverride: secret?.model_override ?? null,
			});
		}
	}, [open, secret, form]);

	const onSubmit = async (values: SecretFormValues) => {
		if (!isEdit && !values.rawKey?.trim()) {
			form.setError("rawKey", { message: "创建时必须填写 API Key" });
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
		if (form.formState.isDirty) {
			const ok = await confirm({ title: "关闭密钥编辑", message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(o) => {
			if (!o) {
				void requestClose();
			}
		}}>
			<DialogContent
				title={isEdit ? "编辑密钥凭证" : "添加密钥凭证"}
				maxWidth={560}
			>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)}>
						<Stack gap="sm">
							<FormField
								control={form.control}
								name="label"
								render={({ field }) => (
									<FormItem>
										<FormLabel>标签</FormLabel>
										<FormControl>
											<Input
												placeholder="如: DeepSeek 个人账号"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="baseUrl"
								render={({ field }) => (
									<FormItem>
										<FormLabel>API 端点 (Base URL)</FormLabel>
										<FormControl>
											<Input
												placeholder="https://api.deepseek.com"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							{!isEdit && (
								<FormField
									control={form.control}
									name="rawKey"
									render={({ field }) => (
										<FormItem>
											<FormLabel>API Key</FormLabel>
											<FormControl>
												<Input
													type={showKey ? "text" : "password"}
													placeholder="sk-..."
													{...field}
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
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}
							<FormField
								control={form.control}
								name="monthlyLimit"
								render={({ field }) => (
									<FormItem>
										<FormLabel>月度预算上限 (¥, 留空不限制)</FormLabel>
										<FormControl>
											<Input
												type="number"
												step="0.01"
												min="0"
												placeholder="如: 100.00"
												{...field}
												value={field.value ?? ""}
												onChange={(e) =>
													field.onChange(
														e.currentTarget.value === ""
															? null
															: e.currentTarget.valueAsNumber,
													)
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="priority"
								render={({ field }) => (
									<FormItem>
										<FormLabel>优先级 (数字越大越优先)</FormLabel>
										<FormControl>
											<Input
												type="number"
												step="1"
												min="0"
												{...field}
												onChange={(e) =>
													field.onChange(
														e.currentTarget.value === ""
															? 0
															: e.currentTarget.valueAsNumber,
													)
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="modelOverride"
								render={({ field }) => (
									<FormItem>
										<FormLabel>模型覆盖 (可选)</FormLabel>
										<FormControl>
											<Input
												placeholder="如: deepseek-v4-pro"
												{...field}
												value={field.value ?? ""}
												onChange={(e) =>
													field.onChange(e.currentTarget.value || null)
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</Stack>
						<DialogFooter>
							<Button variant="outline" type="button" onClick={() => { void requestClose(); }}>
								取消
							</Button>
							<Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
								{form.formState.isSubmitting ? "保存中..." : "保存"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
