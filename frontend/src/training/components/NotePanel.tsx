import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listNotes, deleteNote } from "@/api/notes";
import { queryKeys } from "@/api/query-keys";
import NoteEditor from "./NoteEditor";
import { FileText, Plus, Trash2 } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
	reflection: "反思",
	soap: "SOAP",
	summary: "总结",
	free: "自由",
};

interface Props {
	recordId?: string;
}

export default function NotePanel({ recordId }: Props) {
	const [showEditor, setShowEditor] = useState(false);
	const rid = recordId ? Number(recordId) : undefined;

	const { data: notes = [], refetch } = useQuery({
		queryKey: queryKeys.notes.byRecord(rid),
		queryFn: () => listNotes(rid),
	});

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground">{notes.length} 条笔记</span>
				<button
					onClick={() => setShowEditor(!showEditor)}
					className="flex items-center gap-1 text-xs text-primary hover:underline"
				>
					<Plus size={14} /> {showEditor ? "关闭" : "新建"}
				</button>
			</div>

			{showEditor && (
				<NoteEditor
					recordId={rid}
					onSaved={() => {
						refetch();
						setShowEditor(false);
					}}
					onCancel={() => setShowEditor(false)}
				/>
			)}

			{notes.length === 0 && !showEditor && (
				<div className="text-center py-8 text-sm text-muted-foreground">
					<FileText size={32} className="mx-auto mb-2 opacity-30" />
					暂无笔记
				</div>
			)}

			<div className="space-y-2">
				{notes.map((note) => (
					<div key={note.id} className="p-3 rounded-lg border bg-card text-sm">
						<div className="flex items-center justify-between mb-1">
							<span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
								{TYPE_LABELS[note.type] || note.type}
							</span>
							<button
								onClick={async () => {
									await deleteNote(note.id);
									refetch();
								}}
								className="text-muted-foreground hover:text-destructive"
							>
								<Trash2 size={12} />
							</button>
						</div>
						{note.title && <p className="font-medium text-xs mb-1">{note.title}</p>}
						<p className="text-xs text-muted-foreground line-clamp-3">
							{typeof note.content === "object"
								? Object.values(note.content).filter(Boolean).join(" | ")
								: String(note.content).slice(0, 120)}
						</p>
					</div>
				))}
			</div>
		</div>
	);
}
