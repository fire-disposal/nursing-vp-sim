import { useQuery } from "@tanstack/react-query";
import { Eye, MessageCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { getQAHistoryAll, getQASessionMessagesAdmin } from "@/api/api-client";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { tdClass, thClass } from "@/lib/styles";
import { cn } from "@/lib/utils";

function truncate(text: string, maxLen: number): string {
	if (!text) return "";
	return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}




export default function QARecordsTab() {
	const [offset, setOffset] = useState(0);
	const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch(
		"",
		200,
	);
	const [previewSessionId, setPreviewSessionId] = useState<number | null>(null);
	const [previewTitle, setPreviewTitle] = useState("");
	const [showPreview, setShowPreview] = useState(false);
	const LIMIT = 20;

	const _toast = useToast();

	useEffect(() => {
		setOffset(0);
	}, [debouncedValue]);

	const { data: recordsData, isLoading } = useQuery({
		queryKey: ["qaHistory", offset, debouncedValue],
		queryFn: () =>
			getQAHistoryAll({
				offset,
				limit: LIMIT,
				search: debouncedValue || undefined,
			}).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 2 * 60_000,
	});

	const { data: previewMessages, isLoading: loadingPreview } = useQuery({
		queryKey: ["qaSessionMessages", previewSessionId],
		queryFn: () =>
			getQASessionMessagesAdmin(previewSessionId!).then((r) => r.data ?? []),
		enabled: previewSessionId !== null,
		staleTime: 2 * 60_000,
	});

	const messages = previewMessages ?? [];

	const records = recordsData?.items ?? [];
	const total = recordsData?.total ?? 0;

	const handlePreview = (sessionId: number, title: string) => {
		setPreviewTitle(title);
		setPreviewSessionId(sessionId);
		setShowPreview(true);
	};

	if (isLoading && offset === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<MessageCircle size={48} />
				<p className="mt-3 text-muted-foreground">加载中...</p>
			</div>
		);
	}

	if (records.length === 0 && offset === 0) {
		return <EmptyState icon={MessageCircle} title="暂无问答记录" />;
	}

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm p-6">
			<div className="flex items-center gap-3 mb-3">
				<div className="relative flex-1 max-w-xs">
					<Search
						size={16}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						type="text"
						placeholder="搜索学生..."
						value={searchInput}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-muted focus-ring focus-visible:bg-card"
					/>
				</div>
				<span className="text-sm text-muted-foreground">
					共 {total} 条问答会话
				</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr>
							<th className={thClass}>学生</th>
							<th className={thClass}>学号</th>
							<th className={thClass}>会话标题</th>
							<th className={thClass}>消息数</th>
							<th className={thClass}>最后活跃</th>
							<th className={thClass}>操作</th>
						</tr>
					</thead>
					<tbody>
						{records.map((r) => (
							<tr key={r.id} className="hover:bg-muted">
								<td className={cn(tdClass, "font-semibold")}>
									{r.student_name || r.student_code}
								</td>
								<td className={tdClass}>{r.student_code || "-"}</td>
								<td
									className={cn(
										tdClass,
										"max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap",
									)}
								>
									{truncate(r.title, 40)}
								</td>
								<td className={tdClass}>{r.message_count}</td>
								<td
									className={cn(
										tdClass,
										"whitespace-nowrap text-sm text-muted-foreground",
									)}
								>
									{new Date(r.updated_at).toLocaleString("zh-CN")}
								</td>
								<td className={tdClass}>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handlePreview(r.id, r.title)}
									>
										<Eye size={14} /> 查看
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<Pagination
				offset={offset}
				limit={LIMIT}
				total={total}
				onChange={setOffset}
			/>

			<Dialog
				open={showPreview}
				onOpenChange={(o) => !o && setShowPreview(false)}
			>
				<DialogContent title={`对话预览：${previewTitle}`} maxWidth={560}>
				<div className="max-h-[60vh] overflow-y-auto py-2">
					{loadingPreview ? (
						<p className="text-center text-muted-foreground/70">加载中...</p>
					) : (
						<div className="flex flex-col gap-3">
							{messages.map((m, i) => (
								<div
									key={m.id || i}
									className={cn(
										"max-w-[70%] px-3.5 py-2.5 rounded-xl text-sm whitespace-pre-wrap break-words",
										m.role === "user"
											? "self-end bg-[#2563eb] text-white"
											: "self-start bg-[#f4f5f7] text-foreground",
									)}
								>
									{m.content}
								</div>
							))}
						</div>
					)}
				</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
