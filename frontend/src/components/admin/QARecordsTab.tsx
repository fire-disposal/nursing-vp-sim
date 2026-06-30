import { useQuery } from "@tanstack/react-query";
import { Eye, MessageCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { getQAHistoryAll, getQASessionMessagesAdmin } from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { formatDateTime } from "@/utils/date";
import { cn } from "@/utils/cn";

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
		queryKey: queryKeys.qa.history({ offset, search: debouncedValue }),
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
		queryKey: queryKeys.qa.messages(previewSessionId),
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

	const columns: DataTableColumn<(typeof records)[number]>[] = [
		{
			key: "student",
			header: "学生",
			cellClassName: "font-semibold",
			render: (r) => r.student_name || r.student_code,
		},
		{
			key: "student_code",
			header: "学号",
			render: (r) => r.student_code || "-",
		},
		{
			key: "title",
			header: "会话标题",
			cellClassName:
				"max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap",
			render: (r) => truncate(r.title, 40),
		},
		{
			key: "message_count",
			header: "消息数",
			render: (r) => r.message_count,
		},
		{
			key: "updated_at",
			header: "最后活跃",
			cellClassName: "whitespace-nowrap text-sm text-muted-foreground",
			render: (r) => formatDateTime(r.updated_at),
		},
		{
			key: "actions",
			header: "操作",
			render: (r) => (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => handlePreview(r.id, r.title)}
				>
					<Eye size={14} /> 查看
				</Button>
			),
		},
	];

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
			<DataTable
				columns={columns}
				rows={records}
				rowKey={(r) => r.id}
				loading={isLoading}
				emptyIcon={MessageCircle}
				emptyTitle="暂无问答记录"
				total={total}
				offset={offset}
				limit={LIMIT}
				onOffsetChange={setOffset}
				bare
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
