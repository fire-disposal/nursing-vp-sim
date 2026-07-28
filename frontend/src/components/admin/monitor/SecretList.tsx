
import type { ApiSecretResponse, FallbackStateResponse } from "@/api/admin/api-management-types";
import { cn } from "@/lib/utils";
import {
	costColorClass,
	recoveryText,
	statusText,
} from "@/utils/llm-status";

interface SecretListProps {
	secrets: ApiSecretResponse[];
	envFallback: FallbackStateResponse | undefined;
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
					{envFallback?.available !== undefined && (
						<tr className="bg-emerald-50/50 dark:bg-emerald-950/20">
							<td className="py-2 px-3 whitespace-nowrap">
								<span className="inline-block w-2 h-2 rounded-full mr-2 align-middle bg-green-500" />
								<span className="font-semibold">
									环境变量
								</span>
								<span className="ml-1 text-[10px] px-1 py-px rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
									当前
								</span>
							</td>
							<td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
								sk-...{envFallback?.key_suffix || "****"}
							</td>
							<td className="py-2 px-3 text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
								{envFallback?.available ? "可用" : "不可用"}
							</td>
							<td className="py-2 px-3 text-xs text-muted-foreground/60 whitespace-nowrap">
								{(envFallback?.call_count ?? 0) > 0
									? `${envFallback?.call_count}次 · ¥${envFallback?.total_cost}`
									: ""}
							</td>
							<td className="py-2 px-3" />
						</tr>
					)}
					{[...secrets]
						.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
						.map((s) => {
						const cost = Number(s.monthly_cost_used ?? 0);
						const limit = s.monthly_cost_limit ?? null;
						const isDisabled = s.status === "disabled";
						const _recovery =
							s.status === "degraded"
								? recoveryText(s.degraded_until, s.degraded_reason)
								: "";
						return (
							<tr key={s.id} className={cn("hover:bg-muted/40", isDisabled && "opacity-50")}>
								<td className="py-2 px-3 whitespace-nowrap">
									<span
										className={cn(
											"inline-block w-2 h-2 rounded-full mr-2 align-middle",
											STATUS_DOT[s.status] || "bg-gray-400",
										)}
									/>
									<span className="font-semibold">{s.label}</span>
									{isDisabled && (
										<span className="ml-1 text-[10px] text-muted-foreground/50">
											已停用
										</span>
									)}
								</td>
								<td className="py-2 px-3 whitespace-nowrap">
									<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
										P{s.priority ?? 0}
									</span>
								</td>
								<td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
									sk-...{s.key_suffix}
								</td>
								<td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
									{isDisabled ? "已停用" : statusText(s.status)}
								</td>
								<td className="py-2 px-3 text-xs whitespace-nowrap">
									<span className={cn(costColorClass(cost, limit))}>
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
				</tbody>
			</table>
		</div>
	);
}
