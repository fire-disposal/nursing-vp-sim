import { useState } from "react";
import { createNote } from "@/api/notes";

const NOTE_TYPES = [
	{ id: "free", label: "自由笔记", placeholder: "写下你的想法..." },
	{ id: "reflection", label: "训练反思", fields: ["strengths", "weaknesses", "plan", "emotion"] },
	{ id: "soap", label: "SOAP 记录", fields: ["subjective", "objective", "assessment", "plan"] },
	{ id: "summary", label: "病例总结", fields: ["diagnosis", "key_findings", "interventions", "outcome"] },
];

const FIELD_LABELS: Record<string, string> = {
	strengths: "做得好的",
	weaknesses: "改进空间",
	plan: "改进计划",
	emotion: "训练感受",
	subjective: "主观资料(S)",
	objective: "客观资料(O)",
	assessment: "评估(A)",
	diagnosis: "主要问题",
	key_findings: "关键发现",
	interventions: "护理措施",
	outcome: "效果",
};

interface Props {
	recordId?: number;
	onSaved: () => void;
	onCancel: () => void;
}

export default function NoteEditor({ recordId, onSaved, onCancel }: Props) {
	const [type, setType] = useState("free");
	const [title, setTitle] = useState("");
	const [content, setContent] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	const typeConfig = NOTE_TYPES.find((t) => t.id === type);
	const isStructured = type !== "free" && typeConfig?.fields;

	const handleSave = async () => {
		setSaving(true);
		try {
			await createNote({
				record_id: recordId,
				type,
				title,
				is_private: true,
				content: isStructured ? content : { text: content.text || "" },
			});
			onSaved();
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex gap-2">
				{NOTE_TYPES.map((t) => (
					<button
						key={t.id}
						onClick={() => {
							setType(t.id);
							setContent({});
						}}
						className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
							type === t.id
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			<input
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="笔记标题（可选）"
				className="w-full px-3 py-2 text-sm border rounded-lg"
			/>

			{isStructured ? (
				<div className="space-y-3">
					{typeConfig!.fields!.map((field) => (
						<div key={field}>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								{FIELD_LABELS[field] || field}
							</label>
							<textarea
								value={content[field] || ""}
								onChange={(e) => setContent((c) => ({ ...c, [field]: e.target.value }))}
								rows={3}
								className="w-full px-3 py-2 text-sm border rounded-lg resize-none"
							/>
						</div>
					))}
				</div>
			) : (
				<textarea
					value={content.text || ""}
					onChange={(e) => setContent({ text: e.target.value })}
					placeholder={typeConfig?.placeholder || "写下你的想法..."}
					rows={8}
					className="w-full px-3 py-2 text-sm border rounded-lg resize-none"
				/>
			)}

			<div className="flex gap-2 justify-end">
				<button
					onClick={onCancel}
					className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
				>
					取消
				</button>
				<button
					onClick={handleSave}
					disabled={saving}
					className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
				>
					{saving ? "保存中..." : "保存笔记"}
				</button>
			</div>
		</div>
	);
}
