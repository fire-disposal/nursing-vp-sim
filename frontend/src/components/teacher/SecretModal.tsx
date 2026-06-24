import { useEffect, useState } from "react";
import { createSecret, updateSecret } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
	const [label, setLabel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [rawKey, setRawKey] = useState("");
	const [priceInput, setPriceInput] = useState("0.5");
	const [priceOutput, setPriceOutput] = useState("0.5");
	const [monthlyLimit, setMonthlyLimit] = useState("");
	const [saving, setSaving] = useState(false);
	const { success, apiError } = useToast();
	const isEdit = secret != null;

	useEffect(() => {
		if (open) {
			setLabel(secret?.label || "");
			setBaseUrl(secret?.base_url || "");
			setRawKey("");
			setPriceInput(String(secret?.price_input_per_1m ?? 0.5));
			setPriceOutput(String(secret?.price_output_per_1m ?? 0.5));
			setMonthlyLimit(
				secret?.monthly_cost_limit != null
					? String(secret.monthly_cost_limit)
					: "",
			);
		}
	}, [open, secret]);

	const handleSave = async () => {
		if (!label.trim()) return;
		if (!isEdit && !rawKey.trim()) return;
		setSaving(true);
		try {
			const pricing = {
				price_input_per_1m: parseFloat(priceInput) || 0,
				price_output_per_1m: parseFloat(priceOutput) || 0,
				monthly_cost_limit: monthlyLimit ? parseFloat(monthlyLimit) : null,
			};
			if (isEdit) {
				await updateSecret(secret.id, {
					label: label.trim(),
					base_url: baseUrl.trim(),
					...pricing,
				});
				success("密钥已更新");
			} else {
				await createSecret({
					label: label.trim(),
					raw_key: rawKey.trim(),
					base_url: baseUrl.trim() || undefined,
					...pricing,
				});
				success("密钥已创建");
			}
			onSaved();
			onClose();
		} catch (e: unknown) {
			apiError(e, "保存失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={isEdit ? "编辑密钥凭证" : "添加密钥凭证"}
				maxWidth={560}
			>
			<div className="flex flex-col gap-3">
				<label>
					<div className="mb-1 font-semibold text-sm">标签</div>
					<input
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="如: DeepSeek 个人账号"
						className={inputClass}
					/>
				</label>
				<label>
					<div className="mb-1 font-semibold text-sm">API 端点 (Base URL)</div>
					<input
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder="https://api.deepseek.com"
						className={`${inputClass} font-mono`}
					/>
				</label>
				{!isEdit && (
					<label>
						<div className="mb-1 font-semibold text-sm">API Key</div>
						<input
							type="password"
							value={rawKey}
							onChange={(e) => setRawKey(e.target.value)}
							placeholder="sk-..."
							className={inputClass}
						/>
					</label>
				)}
				<div className="grid grid-cols-2 gap-3">
					<label>
						<div className="mb-1 font-semibold text-sm">
							输入价格 (¥/1M tokens)
						</div>
						<input
							type="number"
							step="0.01"
							min="0"
							value={priceInput}
							onChange={(e) => setPriceInput(e.target.value)}
							className={inputClass}
						/>
					</label>
					<label>
						<div className="mb-1 font-semibold text-sm">
							输出价格 (¥/1M tokens)
						</div>
						<input
							type="number"
							step="0.01"
							min="0"
							value={priceOutput}
							onChange={(e) => setPriceOutput(e.target.value)}
							className={inputClass}
						/>
					</label>
				</div>
				<label>
					<div className="mb-1 font-semibold text-sm">
						月度预算上限 (¥, 留空不限制)
					</div>
					<input
						type="number"
						step="0.01"
						min="0"
						value={monthlyLimit}
						onChange={(e) => setMonthlyLimit(e.target.value)}
						placeholder="如: 100.00"
						className={inputClass}
					/>
				</label>
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving ? "保存中..." : "保存"}
					</Button>
				</div>
			</div>
			</DialogContent>
		</Dialog>
	);
}
