import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteNote, listNotes } from "@/api/notes";
import { queryKeys } from "@/api/query-keys";
import type { SceneCardProps } from "@/engine/scene-card";
import NoteEditor from "@/training/components/NoteEditor";

const TYPE_LABELS: Record<string, string> = {
  reflection: "反思", soap: "SOAP", summary: "总结", free: "自由",
};

type NoteItem = Record<string, unknown> & { id: number; title: string; type: string };

export default function NotesCard({ recordId }: SceneCardProps) {
  const [showEditor, setShowEditor] = useState(false);
  const rid = Number(recordId);
  const { data: notes = [], isLoading, refetch } = useQuery<NoteItem[]>({
    queryKey: queryKeys.notes.byRecord(rid),
    queryFn: () => listNotes(rid) as unknown as Promise<NoteItem[]>,
  });

  if (showEditor) {
    return <NoteEditor recordId={rid} onSaved={() => { setShowEditor(false); refetch(); }} onCancel={() => setShowEditor(false)} />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{notes.length} 条笔记</span>
        <button onClick={() => setShowEditor(true)}
          className="flex items-center gap-1 text-xs text-primary hover:underline">
          <Plus size={12} />写笔记
        </button>
      </div>

      {notes.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">暂无笔记</p>
      )}

      {notes.map((note) => (
        <div key={note.id} className="rounded-lg border p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {TYPE_LABELS[note.type] || note.type}
            </span>
            <button onClick={() => deleteNote(note.id).then(() => refetch())} className="text-muted-foreground hover:text-destructive">
              <Trash2 size={12} />
            </button>
          </div>
          <p className="text-sm font-medium mb-0.5">{note.title}</p>
          <p className="text-xs text-muted-foreground line-clamp-3">{String(note.content ?? "")}</p>
        </div>
      ))}
    </div>
  );
}
