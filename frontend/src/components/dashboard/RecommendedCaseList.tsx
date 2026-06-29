import { ArrowRight, BookOpen, Star, Stethoscope } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/utils/cn";

type CaseBrief = components["schemas"]["CaseBrief"];

interface PatientSummary {
	gender?: string;
	age?: number;
	chief_complaint?: string;
}

function getPatientSummary(ps: unknown): PatientSummary {
	if (ps && typeof ps === "object") return ps as PatientSummary;
	return {};
}

export default function RecommendedCaseList({
	recentCases,
	navigate,
}: {
	recentCases: CaseBrief[];
	navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
}) {
	if (recentCases.length === 0) return null;

	return (
		<Card size="sm">
			<CardHeader className="flex-row items-center justify-between border-b pb-4">
				<CardTitle className="flex items-center gap-2">
					<BookOpen size={17} />
					推荐病例
				</CardTitle>
				<CardAction>
					<Button
						variant="link"
						size="sm"
						onClick={() => navigate("/training")}
					>
						查看全部 →
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="pt-4">
				<div className="flex flex-col gap-1">
					{recentCases.map((c) => {
						const p = getPatientSummary(c.patient_summary);
						const d = c.difficulty || 1;
						return (
							<div
								key={c.id}
								className="flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors hover:bg-muted/50"
								onClick={() => navigate("/training")}
							>
								<div className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
									<Stethoscope size={16} />
								</div>
								<div className="flex-1 min-w-0">
									<div className="text-sm font-semibold text-foreground">
										{c.name}
										<span
										className={cn(
											"inline-flex items-center gap-0.5 ml-2 px-2 py-0.5 rounded-full text-xs font-semibold",
											d === 1 && "bg-success text-success-foreground",
											d === 2 && "bg-warning text-warning-foreground",
											d === 3 && "bg-danger text-danger-foreground",
										)}
									>
										{Array.from({ length: d }).map((_, si) => (
											<Star
												key={`f-${si}`}
												size={12}
												className="text-warning-foreground"
												fill="currentColor"
											/>
										))}
										{Array.from({ length: 3 - d }).map((_, si) => (
											<Star
												key={`e-${si}`}
												size={12}
												className="text-muted-foreground/40"
												fill="none"
											/>
										))}
									</span>
									</div>
									<div className="text-xs text-muted-foreground">
										{p.gender} · {p.age}岁 ·{" "}
										{p.chief_complaint || "查看详情"}
									</div>
								</div>
								<ArrowRight
									size={14}
									className="text-muted-foreground shrink-0"
								/>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
