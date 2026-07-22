import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { createSecret, updateSecret } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { type SecretFormValues, secretFormSchema } from "@/schemas/secret";

type Schemas = components["schemas"];
type ApiSecretResponse = Schemas["ApiSecretResponse"];

interface SecretModalProps {
	open: boolean;
	secret: ApiSecretResponse | null;
	onClose: () => void;
	onSaved: () => void;
}

const inputClass =
	"w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus-ring";

export default function SecretModal({
	open,
	secret,
	onClose,
	onSaved,
}: SecretModalProps) {
	const { success, apiError } = useToast();
	const isEdit = secret != null;
	const [showKey, setShowKey] = useState(false);

	const form = useForm<SecretFormValues>({
		resolver: zodResolver(secretFormSchema),
		defaultValues: {
			label: "",
			baseUrl: "",
			rawKey: "",
			priceInput: 0.5,
			priceOutput: 0.5,
			monthlyLimit: null,
		},
	});

	useEffect(() => {
		if (open) {
			form.reset({
				label: secret?.label ?? "",
				baseUrl: secret?.base_url ?? "",
				rawKey: "",
				priceInput: secret?.price_input_per_1m ?? 0.5,
				priceOutput: secret?.price_output_per_1m ?? 0.5,
				monthlyLimit: secret?.monthly_cost_limit ?? null,
			});
		}
	}, [open, secret, form]);

	const onSubmit = async (values: SecretFormValues) => {
		if (!isEdit && !values.rawKey?.trim()) {
			form.setError("rawKey", { message: "创建时必须填写 API Key" });
			return;
		}
		try {
			const pricing = {
				price_input_per_1m: values.priceInput,
				price_output_per_1m: values.priceOutput,
				monthly_cost_limit: values.monthlyLimit,
			};
			if (isEdit) {
				await updateSecret(secret.id, {
					label: values.label.trim(),
					base_url: values.baseUrl?.trim() ?? "",
					...pricing,
				});
				success("密钥已更新");
			} else {
				await createSecret({
					label: values.label.trim(),
					raw_key: values.rawKey?.trim() ?? "",
					base_url: values.baseUrl?.trim() || undefined,
					...pricing,
				});
				success("密钥已创建");
			}
			onSaved();
			onClose();
		} catch (e: unknown) {
			apiError(e, "保存失败");
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => {
			if (!o) {
				if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return;
				onClose();
			}
		}}>
			<DialogContent
				title={isEdit ? "编辑密钥凭证" : "添加密钥凭证"}
				maxWidth={560}
			>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)}>
						<div className="flex flex-col gap-3">
							<FormField
								control={form.control}
								name="label"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="mb-1 font-semibold text-sm">
											标签
										</FormLabel>
										<FormControl>
											<input
												placeholder="如: DeepSeek 个人账号"
												className={inputClass}
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
										<FormLabel className="mb-1 font-semibold text-sm">
											API 端点 (Base URL)
										</FormLabel>
										<FormControl>
											<input
												placeholder="https://api.deepseek.com"
												className={`${inputClass} font-mono`}
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
											<FormLabel className="mb-1 font-semibold text-sm">
												API Key
											</FormLabel>
											<FormControl>
												<div className="relative">
													<input
														type={showKey ? "text" : "password"}
														placeholder="sk-..."
														className={`${inputClass} pr-9`}
														{...field}
													/>
													<button
														type="button"
														onClick={() => setShowKey((v) => !v)}
														className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
														title={showKey ? "隐藏" : "显示"}
													>
														{showKey ? <EyeOff size={15} /> : <Eye size={15} />}
													</button>
												</div>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}
							<div className="grid grid-cols-2 gap-3">
								<FormField
									control={form.control}
									name="priceInput"
									render={({ field }) => (
										<FormItem>
											<FormLabel className="mb-1 font-semibold text-sm">
												输入价格 (¥/1M tokens)
											</FormLabel>
											<FormControl>
											<input
												type="number"
												step="0.01"
												min="0"
												className={inputClass}
												{...field}
												value={Number.isNaN(field.value) ? "" : field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value === ""
															? Number.NaN
															: e.target.valueAsNumber,
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
									name="priceOutput"
									render={({ field }) => (
										<FormItem>
											<FormLabel className="mb-1 font-semibold text-sm">
												输出价格 (¥/1M tokens)
											</FormLabel>
											<FormControl>
											<input
												type="number"
												step="0.01"
												min="0"
												className={inputClass}
												{...field}
												value={Number.isNaN(field.value) ? "" : field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value === ""
															? Number.NaN
															: e.target.valueAsNumber,
													)
												}
											/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<FormField
								control={form.control}
								name="monthlyLimit"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="mb-1 font-semibold text-sm">
											月度预算上限 (¥, 留空不限制)
										</FormLabel>
										<FormControl>
											<input
												type="number"
												step="0.01"
												min="0"
												placeholder="如: 100.00"
												className={inputClass}
												{...field}
												value={field.value ?? ""}
												onChange={(e) =>
													field.onChange(
														e.target.value === "" ? null : e.target.valueAsNumber,
													)
												}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<DialogFooter className="mt-4">
							<Button variant="outline" type="button" onClick={() => { if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return; onClose(); }}>
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
