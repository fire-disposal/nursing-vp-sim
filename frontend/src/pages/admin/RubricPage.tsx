import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import type { ApiPath } from "@/api/api-path";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";

interface RubricItem {
	id: string;
	name: string;
	anchors: Record<string, string>;
}

interface RubricDimension {
	id: string;
	name: string;
	max: number;
	description?: string;
	items: RubricItem[];
}

interface RubricData {
	id: string;
	name: string;
	version: string;
	total_max: number;
	scale: number;
	raw_max: number;
	raw_scale: number;
	dimensions: RubricDimension[];
}

export default function RubricPage() {
	const { data, isLoading } = useQuery({
		queryKey: ["rubric", "current"],
		queryFn: () =>
			api.get("/rubrics/current" satisfies ApiPath as string).then((r) => r.data),
		staleTime: 30 * 60_000,
	});

	if (isLoading) return <LoadingSkeleton />;
	if (!data) return <div className="p-8 text-center text-muted-foreground">加载失败</div>;

	const rubric = data as RubricData;

	return (
		<div className="space-y-6">
			<PageHeader
				title="评分标准"
				subtitle={`${rubric.name} · v${rubric.version} · 满分 ${rubric.total_max} 分`}
				icon={BookOpen}
			/>
			<p className="text-xs text-muted-foreground">
				此页面为只读视图，修改评分标准请编辑服务器上的 JSON 配置文件，改动后自动生效。
			</p>
			{rubric.dimensions.map((dim) => (
				<Card key={dim.id}>
					<CardHeader className="border-b">
						<CardTitle>{dim.name}</CardTitle>
						<p className="text-xs text-muted-foreground mt-0.5">
							满分 {dim.max} 分{dim.description ? ` · ${dim.description}` : ""}
						</p>
					</CardHeader>
					<CardContent className="pt-4">
						<div className="divide-y">
							{dim.items.map((item) => (
								<div key={item.id} className="py-4 first:pt-0 last:pb-0">
									<p className="text-sm font-medium">{item.name}</p>
									<div className="mt-2 space-y-1">
										{Object.entries(item.anchors).map(([score, desc]) => (
											<div key={score} className="flex items-start gap-3 text-sm">
												<span className="font-mono font-bold text-primary shrink-0 w-6">
													{score}分
												</span>
												<span className="text-muted-foreground">{desc}</span>
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
