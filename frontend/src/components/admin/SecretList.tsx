import { Info } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import { cn } from "@/utils/cn";
import {
	costColorClass,
	degradedReasonLabel,
	recoveryText,
	statusText,
} from "./llm-status";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type FallbackState = components["schemas"]["FallbackStateResponse"];

interface SecretListProps {
	secrets: ApiSecretResponse[];
	envFallback: FallbackState | undefined;
	onEdit: (secret: ApiSecretResponse) => void;
	onDelete: (secret: ApiSecretResponse) => void;
}

const STATUS_DOT: Record<string, string> = {
	active: "bg-green-500",
	degraded: "bg-amber-500",
	disabled: "bg-red-400",
};

export default function SecretList({
	secrets,
	envFallback,
	onEdit,
	onDelete,
}: SecretListProps) {
	return (
		<div className="border border-border rounded-lg overflow-hidden">
			<table className="w-full text-sm">
				<tbody className="divide-y divide-border">
					{secrets.map((s) => {
						const cost = Number(s.monthly_cost_used ?? 0);
						const limit = s.monthly_cost_limit ?? null;
						const recovery =
							s.status === "degraded"
								? recoveryText(s.degraded_until, s.degraded_reason)
								: "";
						return (
							<tr key={s.id} className="hover:bg-muted/40">
								<td className="py-2 px-3 whitespace-nowrap">
									<span
										className={cn(
											"inline-block w-2 h-2 rounded-full mr-2 align-middle",
											STATUS_DOT[s.status] || "bg-gray-400",
										)}
									/>
									<span className="font-semibold">{s.label}</span>
								</td>
								<td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
									sk-...{s.key_suffix}
								</td>
								<td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
									{statusText(s.status)}
									{s.status === "degraded" && (
										<span className="text-muted-foreground/60">
											{" · "}
											{degradedReasonLabel(s.degraded_reason)}
											{recovery ? ` · ${recovery}` : ""}
										</span>
									)}
								</td>
								<td className="py-2 px-3 text-xs whitespace-nowrap">
									<span
										className={cn(costColorClass(cost, limit))}
									>
										¥{cost.toFixed(2)} /{" "}
										{limit ? `¥${Number(limit).toFixed(0)}` : "不限"}
									</span>
								</td>
								<td className="py-2 px-3 whitespace-nowrap">
									<div className="flex gap-1">
										<button
											onClick={() => onEdit(s)}
											className="text-xs text-muted-foreground hover:text-foreground"
										>
											编辑
										</button>
										<button
											onClick={() => onDelete(s)}
											className="text-xs text-destructive hover:text-destructive/80"
										>
											删除
										</button>
									</div>
								</td>
							</tr>
						);
					})}
					{envFallback?.available !== undefined && (
						<tr className="bg-muted/20">
							<td className="py-2 px-3 whitespace-nowrap">
								<span
									className={cn(
										"inline-block w-2 h-2 rounded-full mr-2 align-middle",
										envFallback?.degraded_until &&
											new Date(envFallback.degraded_until) > new Date()
											? "bg-amber-500"
											: envFallback?.available
												? "bg-green-400"
												: "bg-red-400",
									)}
								/>
								<span className="font-semibold text-muted-foreground">
									环境变量兜底
								</span>
								<span className="ml-1 text-[10px] px-1 py-px rounded bg-muted text-muted-foreground/70">
									兜底
								</span>
							</td>
							<td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
								sk-...{envFallback?.key_suffix || "****"}
							</td>
							<td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
								{							envFallback?.degraded_until &&
								new Date(envFallback.degraded_until) > new Date()
									? `熔断 · ${degradedReasonLabel(envFallback?.degraded_reason)}`
									: envFallback?.available
										? "可用"
										: "不可用"}
							</td>
							<td className="py-2 px-3 text-xs text-muted-foreground/60 whitespace-nowrap">
								{(envFallback?.call_count ?? 0) > 0
									? `${envFallback?.call_count}次 · ¥${envFallback?.total_cost}`
									: ""}
							</td>
							<td className="py-2 px-3">
								<button
									className="text-muted-foreground/40 hover:text-muted-foreground/70"
									title="数据库无可用密钥时自动回退到此环境变量密钥"
								>
									<Info size={12} />
								</button>
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
