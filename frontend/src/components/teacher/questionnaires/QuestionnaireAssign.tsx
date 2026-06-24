import type {
	AssignForm as AssignFormType,
	CaseBrief,
} from "@/components/teacher/questionnaires/types";
import {
	inputClass,
	TRIGGER_EVENT_OPTIONS,
} from "@/components/teacher/questionnaires/types";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface QuestionnaireAssignProps {
	open: boolean;
	templateTitle: string;
	allCases: CaseBrief[];
	assignForm: AssignFormType;
	isSaving: boolean;
	onClose: () => void;
	onSubmit: (e: React.FormEvent) => void;
	onAssignFormChange: React.Dispatch<React.SetStateAction<AssignFormType>>;
}

export default function QuestionnaireAssign({
	open,
	templateTitle,
	allCases,
	assignForm,
	isSaving,
	onClose,
	onSubmit,
	onAssignFormChange,
}: QuestionnaireAssignProps) {
	const toggleCaseId = (caseId: number) => {
		onAssignFormChange((prev) => ({
			...prev,
			case_ids: prev.case_ids.includes(caseId)
				? prev.case_ids.filter((id) => id !== caseId)
				: [...prev.case_ids, caseId],
		}));
	};

	const selectAllCases = () => {
		onAssignFormChange((prev) => ({
			...prev,
			case_ids: allCases.map((c) => c.id),
		}));
	};

	const deselectAllCases = () => {
		onAssignFormChange((prev) => ({
			...prev,
			case_ids: [],
		}));
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={`分配病例: ${templateTitle}`}
				maxWidth={600}
			>
			<form onSubmit={onSubmit} className="flex flex-col gap-4">
				<div>
					<div className="flex items-center justify-between mb-2">
						<label className="text-xs font-semibold text-muted-foreground">
							选择病例
						</label>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={selectAllCases}
								className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none"
							>
								全选
							</button>
							<button
								type="button"
								onClick={deselectAllCases}
								className="text-xs text-muted-foreground hover:underline cursor-pointer bg-transparent border-none"
							>
								取消全选
							</button>
						</div>
					</div>
					<div className="max-h-[300px] overflow-y-auto border border-border rounded-lg p-3 space-y-1">
						{allCases.length === 0 ? (
							<div className="text-sm text-muted-foreground text-center py-4">
								暂无病例数据
							</div>
						) : (
							allCases.map((c) => (
								<label
									key={c.id}
									className={cn(
										"flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm cursor-pointer transition-colors",
										assignForm.case_ids.includes(c.id)
											? "bg-primary/5"
											: "hover:bg-muted",
									)}
								>
									<input
										type="checkbox"
										checked={assignForm.case_ids.includes(c.id)}
										onChange={() => toggleCaseId(c.id)}
										className="rounded"
									/>
									<span className="font-medium">{c.name}</span>
									{c.chief_complaint && (
										<span className="text-xs text-muted-foreground truncate max-w-[200px]">
											— {c.chief_complaint}
										</span>
									)}
								</label>
							))
						)}
					</div>
					<div className="text-xs text-muted-foreground mt-1">
						已选 {assignForm.case_ids.length} 个病例
					</div>
				</div>

				<div className="flex gap-3">
					<div className="flex-1">
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							触发时机
						</label>
						<select
							value={assignForm.trigger_event}
							onChange={(e) =>
								onAssignFormChange((f) => ({
									...f,
									trigger_event: e.target.value,
								}))
							}
							className={inputClass}
						>
							{TRIGGER_EVENT_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</div>
					<div className="flex-1">
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							是否必填
						</label>
						<div className="flex items-center gap-2 pt-2">
							<label className="relative inline-flex items-center cursor-pointer">
								<input
									type="checkbox"
									checked={assignForm.is_required}
									onChange={(e) =>
										onAssignFormChange((f) => ({
											...f,
											is_required: e.target.checked,
										}))
									}
									className="sr-only peer"
								/>
								<div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
							</label>
							<span className="text-sm text-muted-foreground">
								{assignForm.is_required ? "必填" : "选填"}
							</span>
						</div>
					</div>
				</div>

				<div className="flex gap-3 justify-end">
					<Button type="button" variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button type="submit" disabled={isSaving}>
						{isSaving ? "保存中..." : "保存分配"}
					</Button>
				</div>
			</form>
			</DialogContent>
		</Dialog>
	);
}
