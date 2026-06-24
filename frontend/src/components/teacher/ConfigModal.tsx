import { useEffect, useRef, useState } from "react";
import { createConfig, fetchSecrets, updateConfig } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

interface ConfigModalProps {
	open: boolean;
	configData: LLMConfigResponse | null;
	prefilled?: { secret_id?: number; purpose?: string } | null;
	onClose: () => void;
	onSaved: () => void;
}

const PURPOSE_QUICK = [
	{
		purpose: "scoring",
		label: "评分",
		desc: "DeepSeek Pro — 高精度评分",
		icon: "📊",
	},
	{
		purpose: "patient_chat",
		label: "患者对话",
		desc: "DeepSeek Flash — 快速响应",
		icon: "💬",
	},
	{
		purpose: "qa",
		label: "问答",
		desc: "DeepSeek Flash — 通用问答",
		icon: "❓",
	},
	{
		purpose: "case_generation",
		label: "病例生成",
		desc: "DeepSeek Flash — 生成病例",
		icon: "📋",
	},
	{
		purpose: "*",
		label: "通配兜底",
		desc: "DeepSeek Flash — 其他用途后备",
		icon: "🔄",
	},
];

const ALL_PURPOSES = [
	{ value: "*", label: "通配 (全部)" },
	{ value: "qa", label: "问答 (QA)" },
	{ value: "patient_chat", label: "患者对话" },
	{ value: "scoring", label: "评分" },
	{ value: "case_generation", label: "病例生成" },
];

const inputClass =
	"w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus-ring";

export default function ConfigModal({
	open,
	configData,
	prefilled,
	onClose,
	onSaved,
}: ConfigModalProps) {
	const [secrets, setSecrets] = useState<ApiSecretResponse[]>([]);
	const [secretId, setSecretId] = useState("");
	const [saving, setSaving] = useState(false);
	const { success, error, apiError } = useToast();
	const isEdit = configData != null;

	const [label, setLabel] = useState("");
	const [purpose, setPurpose] = useState("qa");

	const selectedSecret = secrets.find((s) => String(s.id) === secretId);
	const initializedRef = useRef(false);

	const autoKey = secrets.length === 1 ? String(secrets[0].id) : "";

	useEffect(() => {
		if (open) {
			const doInit = (secretsList: typeof secrets) => {
				const ak = secretsList.length === 1 ? String(secretsList[0].id) : "";
				if (configData) {
					setSecretId(String(configData.secret_id || ""));
					setLabel(configData.label || "");
					setPurpose(configData.purpose || "qa");
				} else if (prefilled) {
					setSecretId(String(prefilled.secret_id || ak || ""));
					setPurpose(prefilled.purpose || "qa");
				} else {
					setSecretId(ak);
					setLabel("");
					setPurpose("qa");
				}
			};
			fetchSecrets()
				.then(({ data }) => {
					setSecrets(data);
					if (!initializedRef.current) {
						doInit(data);
						initializedRef.current = true;
					}
				})
				.catch(() => {});
		} else {
			initializedRef.current = false;
		}
	}, [open, configData, prefilled]);

	const handleQuickCreate = async (purposeVal: string) => {
		const sid = secretId || autoKey;
		if (!sid) {
			error("请先添加 API 密钥");
			return;
		}
		setSaving(true);
		try {
			await createConfig({
				secret_id: Number(sid),
				label: `${selectedSecret?.label || "key"}-${purposeVal}`,
				purpose: purposeVal,
			});
			success("已创建");
			onSaved();
			onClose();
		} catch (e: unknown) {
			apiError(e, "创建失败");
		} finally {
			setSaving(false);
		}
	};

	const handleSave = async () => {
		const payload = {
			secret_id: Number(secretId),
			label: label || `${selectedSecret?.label || ""}-${purpose}`,
			purpose,
		};
		if (!payload.secret_id) {
			error("请选择密钥");
			return;
		}
		setSaving(true);
		try {
			if (isEdit) {
				await updateConfig(configData.id, payload);
				success("已更新");
			} else {
				await createConfig(payload);
				success("已创建");
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
		<Modal
			open={open}
			onClose={onClose}
			title={isEdit ? "编辑绑定" : "添加用途绑定"}
		>
			<div className="mb-3">
				<div className="mb-1 font-semibold text-sm">选择密钥</div>
				<select
					value={secretId}
					onChange={(e) => setSecretId(e.target.value)}
					className={inputClass}
				>
					<option value="">选择密钥...</option>
					{secrets.map((s) => (
						<option key={s.id} value={s.id}>
							{s.label} (sk-...{s.key_suffix})
						</option>
					))}
				</select>
				{selectedSecret && (
					<div className="text-[0.72rem] text-muted-foreground/70 mt-0.5">
						{selectedSecret.base_url || "https://api.deepseek.com"}
					</div>
				)}
			</div>

			{!isEdit ? (
				<div>
					<div className="mb-2 text-sm font-semibold text-muted-foreground">
						快速创建 — 点击卡片一键配置
					</div>
					<div className="grid grid-cols-2 gap-2 mb-3">
						{PURPOSE_QUICK.map((p) => (
							<button
								key={p.purpose}
								onClick={() => handleQuickCreate(p.purpose)}
								disabled={saving || !(secretId || autoKey)}
								className="p-3 rounded-md border border-border bg-card cursor-pointer text-left flex flex-col gap-0.5 hover:bg-muted disabled:opacity-50"
							>
								<span className="text-lg">{p.icon}</span>
								<span className="font-semibold text-sm">{p.label}</span>
								<span className="text-[0.7rem] text-muted-foreground/70">
									{p.desc}
								</span>
							</button>
						))}
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<label>
						<div className="mb-1 font-semibold text-sm">配置标签</div>
						<input
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="如: QA用Pro"
							className={inputClass}
						/>
					</label>
					<div>
						<div className="mb-1 font-semibold text-sm">用途</div>
						<select
							value={purpose}
							onChange={(e) => setPurpose(e.target.value)}
							className={inputClass}
						>
							{ALL_PURPOSES.map((p) => (
								<option key={p.value} value={p.value}>
									{p.label}
								</option>
							))}
						</select>
					</div>
				</div>
			)}

			{isEdit && (
				<div className="flex justify-end gap-2 mt-3">
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving ? "保存中..." : "保存"}
					</Button>
				</div>
			)}
		</Modal>
	);
}
