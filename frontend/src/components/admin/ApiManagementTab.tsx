import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	ChevronDown,
	ChevronRight,
	Edit3,
	Info,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import {
	createConfig,
	deleteConfig,
	deleteSecret,
	fetchConfigs,
	fetchEnvFallback,
	fetchSecrets,
	reloadRouter,
	resetConfig,
	testAllConfigs,
	testConfig,
	toggleConfig,
	updateConfig,
} from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import Tooltip from "@/components/ui/tooltip";
import { LLM_PURPOSES } from "@/config/llm-purposes";
import { cn } from "@/utils/cn";
import {
	costColorClass,
	degradedReasonLabel,
	recoveryText,
	statusText,
} from "./llm-status";
import SecretModal from "./SecretModal";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

const PURPOSES = LLM_PURPOSES.map((p) => ({ key: p.value, label: p.label, desc: p.desc }));

const STATUS_DOT: Record<string, string> = {
	active: "bg-green-500",
	degraded: "bg-amber-500",
	disabled: "bg-red-400",
};

const selectClass =
	"py-0.5 px-1.5 border border-border rounded-md text-sm bg-card";

export default function ApiManagementTab() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const [showSecretModal, setShowSecretModal] = useState(false);
	const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(
		null,
	);
	const [bindingsOpen, setBindingsOpen] = useState(false);
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

	const configsByPurpose: Record<string, LLMConfigResponse[]> = {};
	configs.forEach((c) => {
		if (!configsByPurpose[c.purpose]) configsByPurpose[c.purpose] = [];
		configsByPurpose[c.purpose].push(c);
	});

	const getConfig = (purpose: string) => {
		const items = (configsByPurpose[purpose] || []).sort(
			(a, b) => (a.id || 0) - (b.id || 0),
		);
		return items.find((c) => c.status === "active") || items[0] || null;
	};

	const handleDeleteSecret = async (s: ApiSecretResponse) => {
		const boundPurposes = configs
			.filter((c) => c.secret_id === s.id && c.status !== "disabled")
			.map((c) => c.purpose);
		if (boundPurposes.length > 0) {
			const list = boundPurposes.join("、");
			if (
				!(await confirm({
					title: "无法删除",
					message: `该档案仍绑定 ${boundPurposes.length} 个用途（${list}），请先在「用途路由」面板中移除此密钥的用途指派后再删除。`,
					danger: true,
				}))
			)
				return;
			return;
		}
		if (
			!(await confirm({
				title: "删除档案",
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
			toast.apiError(e, "失败");
		}
	};

	const handleDeleteConfig = async (c: LLMConfigResponse) => {
		if (
			!(await confirm({
				title: "解除绑定",
				message: "移除此用途指派？",
				danger: true,
			}))
		)
			return;
		try {
			await deleteConfig(c.id);
			toast.success("已解除");
			invalidate();
		} catch (e: unknown) {
			toast.apiError(e, "失败");
		}
	};
	const handleToggle = async (c: LLMConfigResponse) => {
		try {
			await toggleConfig(c.id);
			invalidate();
		} catch (e: unknown) {
			toast.apiError(e, "失败");
		}
	};
	const handleReset = async (c: LLMConfigResponse) => {
		try {
			await resetConfig(c.id);
			invalidate();
		} catch (e: unknown) {
			toast.apiError(e, "失败");
		}
	};
	const handleTest = async (c: LLMConfigResponse) => {
		try {
			const r = await testConfig(c.id);
			r.data.ok
				? toast.success(`延迟 ${r.data.latency_ms}ms`)
				: toast.error(r.data.error || "不通");
		} catch {
			toast.error("测试失败");
		}
	};

	const handleQuickBind = async (
		purpose: string,
		secretId: number,
	) => {
		try {
			await createConfig({ secret_id: secretId, purpose, label: "" });
			toast.success("已绑定");
			invalidate();
		} catch (e: unknown) {
			toast.apiError(e, "绑定失败");
		}
	};

	const handleTestAll = async () => {
		setTestingAll(true);
		try {
			const r = await testAllConfigs();
			const results = r.data.results ?? [];
			const ok = results.filter((x) => x.ok).length;
			const fail = results.length - ok;
			fail === 0
				? toast.success(`全部连通（${ok} 项）`)
				: toast.error(`成功 ${ok} · 失败 ${fail}`);
		} catch {
			toast.error("测试失败");
		} finally {
			setTestingAll(false);
		}
	};

	return (
		<>
			{/* Secrets table */}
			<div className="mb-4">
				<div className="flex justify-between items-center mb-2">
					<h3 className="text-sm font-semibold text-foreground">API 密钥</h3>
					<div className="flex gap-2">
						<button
							onClick={handleTestAll}
							disabled={testingAll}
							className="inline-flex items-center gap-1 py-1 px-3 border border-border rounded-md bg-muted text-foreground cursor-pointer text-sm disabled:opacity-50"
						>
							<Activity size={14} /> {testingAll ? "测试中..." : "测试全部"}
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
				<div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
					{secrets.length === 0 && !envFallback?.available && (
						<EmptyState
							title="暂无密钥"
							description="添加 DeepSeek API Key 以开始使用"
						/>
					)}
					{secrets.map((s) => {
						const cost = Number(s.monthly_cost_used ?? 0);
						const limit = s.monthly_cost_limit ?? null;
						const recovery =
							s.status === "degraded"
								? recoveryText(s.degraded_until, s.degraded_reason)
								: "";
						return (
							<div
								key={s.id}
								className="flex items-center gap-2 py-2 px-3 hover:bg-muted/40"
							>
								<span
									className={cn(
										"inline-block w-[7px] h-[7px] rounded-full shrink-0",
										STATUS_DOT[s.status] || "bg-gray-400",
									)}
								/>
								<span className="font-semibold text-sm truncate">{s.label}</span>
								<span className="text-[0.68rem] text-muted-foreground/70 font-mono shrink-0">
									sk-...{s.key_suffix}
								</span>
								<span className="text-xs text-muted-foreground shrink-0">
									{statusText(s.status)}
									{s.status === "degraded" && (
										<span className="text-muted-foreground/60">
											{" · "}
											{degradedReasonLabel(s.degraded_reason)}
											{recovery ? ` · ${recovery}` : ""}
										</span>
									)}
									{s.config_count > 0 && (
										<span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
											{s.config_count} 用途
										</span>
									)}
								</span>
								<Tooltip
									content={
										limit
											? `本月已用 ¥${cost.toFixed(2)} / 上限 ¥${Number(limit).toFixed(0)} · 今日 ¥${Number(s.total_cost_today ?? 0).toFixed(2)}`
											: `本月已用 ¥${cost.toFixed(2)} · 今日 ¥${Number(s.total_cost_today ?? 0).toFixed(2)}`
									}
								>
									<span
										className={cn(
											"ml-auto text-[0.7rem] shrink-0",
											costColorClass(cost, limit),
										)}
									>
										¥{cost.toFixed(2)} /{" "}
										{limit ? `¥${Number(limit).toFixed(0)}` : "不限"}
									</span>
								</Tooltip>
								<div className="flex gap-0.5 shrink-0">
									<button
										onClick={() => {
											setEditingSecret(s);
											setShowSecretModal(true);
										}}
										className="text-muted-foreground/70 hover:text-foreground p-0.5"
										title="编辑"
									>
										<Edit3 size={12} />
									</button>
									<button
										onClick={() => handleDeleteSecret(s)}
										className="text-destructive p-0.5"
										title="删除"
									>
										<Trash2 size={12} />
									</button>
								</div>
							</div>
						);
					})}
					{/* env 兜底常驻行 */}
					<div className="flex items-center gap-2 py-2 px-3 bg-muted/30">
						<span
							className={cn(
								"inline-block w-[7px] h-[7px] rounded-full shrink-0",
								envFallback?.degraded_until &&
									new Date(envFallback.degraded_until) > new Date()
									? "bg-amber-500"
									: envFallback?.available
										? "bg-green-400"
										: "bg-red-400",
							)}
						/>
						<span className="font-semibold text-sm text-muted-foreground">
							环境变量兜底
						</span>
						<span className="text-[0.6rem] px-1 py-px rounded bg-muted text-muted-foreground/70 shrink-0">
							兜底
						</span>
						<span className="text-[0.68rem] text-muted-foreground/70 font-mono shrink-0">
							sk-...{envFallback?.key_suffix || "****"}
						</span>
						<span className="text-xs text-muted-foreground shrink-0">
							{envFallback?.degraded_until &&
							new Date(envFallback.degraded_until) > new Date() ? (
								<>
									熔断 · {degradedReasonLabel(envFallback.degraded_reason)}
									{recoveryText(
										envFallback.degraded_until,
										envFallback.degraded_reason,
									)
										? ` · ${recoveryText(envFallback.degraded_until, envFallback.degraded_reason)}`
										: ""}
								</>
							) : envFallback?.available ? (
								"可用"
							) : (
								"不可用"
							)}
						</span>
						{envFallback?.call_count != null && envFallback.call_count > 0 && (
							<span className="ml-auto text-[0.68rem] text-muted-foreground/60 shrink-0">
								{envFallback.call_count}次 · ¥{envFallback.total_cost}
							</span>
						)}
						<Tooltip content="数据库无可用密钥时自动回退到此环境变量密钥；连续失败/限流会临时熔断以避免无谓重试">
							<button className="text-muted-foreground/40 hover:text-muted-foreground/70 p-0.5">
								<Info size={12} />
							</button>
						</Tooltip>
					</div>
				</div>
			</div>

			{/* Purpose bindings */}
			<div>
				<div className="flex justify-between items-center mb-2">
					<button
						onClick={() => setBindingsOpen((v) => !v)}
						className="flex items-center gap-1 text-sm font-semibold text-foreground bg-transparent border-none cursor-pointer"
					>
						{bindingsOpen ? (
							<ChevronDown size={14} />
						) : (
							<ChevronRight size={14} />
						)}
						用途路由（{
							new Set(configs.filter((c) => c.status !== "disabled").map((c) => c.purpose)).size
						}/{PURPOSES.length} 已绑定）
					</button>
					<button
						onClick={() =>
							reloadRouter()
								.then(() => {
									invalidate();
									toast.success("已重载");
								})
								.catch(() => toast.error("重载失败"))
						}
						className="inline-flex items-center gap-1 py-1 px-2 border border-border rounded-md bg-muted text-foreground cursor-pointer text-sm"
						title="重载路由"
					>
						<RefreshCw size={14} />
					</button>
				</div>
				{bindingsOpen && (
				<div className="border border-border rounded-lg overflow-hidden">
					{PURPOSES.map((p, i) => {
						const cfg = getConfig(p.key);
						const isLast = i === PURPOSES.length - 1;
						return (
							<div
								key={p.key}
								className={cn(
									"flex items-center py-2 px-3 gap-2 transition-colors duration-150 hover:bg-muted/50",
									!isLast && "border-b border-border",
								)}
							>
								<div className="w-[90px] shrink-0 flex items-center gap-1">
									<span className="font-semibold text-sm">{p.label}</span>
									<Tooltip content={p.desc}>
										<button className="bg-transparent border-none cursor-pointer p-0 text-muted-foreground/30 hover:text-muted-foreground/60 transition-all duration-200 hover:scale-110">
											<Info size={12} />
										</button>
									</Tooltip>
								</div>
								<div className="flex-1 flex items-center gap-2 flex-wrap min-w-0">
									{cfg ? (
										<>
											<select
												value={cfg.secret_id}
												onChange={async (e) => {
													try {
														await updateConfig(cfg.id, {
															secret_id: Number(e.target.value),
														});
														toast.success("已改绑");
														invalidate();
													} catch (err: unknown) {
														toast.apiError(err, "改绑失败");
													}
												}}
												className={selectClass}
											>
												{secrets.map((s) => (
													<option key={s.id} value={s.id}>
														{s.label} (sk-...{s.key_suffix})
													</option>
												))}
											</select>
											<span
												className={cn(
													"inline-flex items-center gap-1 text-sm",
													cfg.status === "active"
														? "text-success-foreground"
														: cfg.status === "degraded"
															? "text-warning-foreground"
															: "text-destructive",
												)}
											>
												<span
													className={cn(
														"inline-block w-[7px] h-[7px] rounded-full",
														STATUS_DOT[cfg.status] || "bg-gray-400",
													)}
												/>
												{cfg.status === "active"
													? "正常"
													: cfg.status === "degraded"
														? "熔断"
														: "关闭"}
											</span>
										</>
									) : (
										<span className="text-sm text-muted-foreground/50">
											未指派
										</span>
									)}
								</div>
								<div className="shrink-0 flex gap-0.5 items-center">
									{cfg ? (
										<>
											{cfg.status === "degraded" ? (
												<button
													onClick={() => handleReset(cfg)}
													className="bg-transparent border-none cursor-pointer text-amber-500 p-0.5"
													title="恢复"
												>
													<RefreshCw size={12} />
												</button>
											) : (
												<button
													onClick={() => handleToggle(cfg)}
													className={cn(
														"bg-transparent border-none cursor-pointer p-0.5 text-xs font-semibold",
														cfg.status === "active"
															? "text-red-400"
															: "text-green-500",
													)}
													title={cfg.status === "active" ? "停用" : "启用"}
												>
													{cfg.status === "active" ? "停" : "启"}
												</button>
											)}
											<button
												onClick={() => handleTest(cfg)}
												className="bg-transparent border-none cursor-pointer text-muted-foreground/70 p-0.5"
												title="测试连通性"
											>
												<Activity size={12} />
											</button>
											<button
												onClick={() => handleDeleteConfig(cfg)}
												className="bg-transparent border-none cursor-pointer text-destructive p-0.5"
												title="解除绑定"
											>
												<Trash2 size={12} />
											</button>
										</>
									) : (
										<select
											onChange={(e) => {
												const sid = Number(e.target.value);
												if (!sid) return;
												handleQuickBind(p.key, sid);
											}}
											className="py-0.5 px-1.5 border border-border rounded-md text-xs bg-card"
										>
											<option value="">绑定到...</option>
											{secrets.map((s) => (
												<option key={s.id} value={s.id}>
													{s.label}
												</option>
											))}
										</select>
									)}
								</div>
							</div>
						);
					})}
				</div>
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
