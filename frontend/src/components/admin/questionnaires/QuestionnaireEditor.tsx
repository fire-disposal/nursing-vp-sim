import { ArrowLeft, GripVertical, Plus, Save, X } from "lucide-react";
import type { TemplateForm } from "@/components/admin/questionnaires/types";
import {
	emptyQuestion,
	QUESTION_TYPE_OPTIONS,
	textareaClass,
} from "@/components/admin/questionnaires/types";
import { inputClass } from "@/utils/styles";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import LoadingState from "@/components/ui/loading-state";

interface QuestionnaireEditorProps {
	open: boolean;
	editingId: number | null;
	form: TemplateForm;
	editMsg: string;
	isLoadingDetail: boolean;
	isSaving: boolean;
	onClose: () => void;
	onSave: (e: React.FormEvent) => void;
	setForm: React.Dispatch<React.SetStateAction<TemplateForm>>;
}

export default function QuestionnaireEditor({
	open,
	editingId,
	form,
	editMsg,
	isLoadingDetail,
	isSaving,
	onClose,
	onSave,
	setForm,
}: QuestionnaireEditorProps) {
	const addQuestion = () => {
		setForm((prev) => ({
			...prev,
			questions: [...prev.questions, emptyQuestion(prev.questions.length + 1)],
		}));
	};

	const removeQuestion = (index: number) => {
		setForm((prev) => ({
			...prev,
			questions: prev.questions
				.filter((_, i) => i !== index)
				.map((q, i) => ({ ...q, sort_order: i + 1 })),
		}));
	};

	const updateQuestion = (
		index: number,
		updates: Partial<(typeof form.questions)[number]>,
	) => {
		setForm((prev) => ({
			...prev,
			questions: prev.questions.map((q, i) =>
				i === index ? { ...q, ...updates } : q,
			),
		}));
	};

	const moveQuestion = (index: number, direction: "up" | "down") => {
		setForm((prev) => {
			const questions = [...prev.questions];
			const targetIndex = direction === "up" ? index - 1 : index + 1;
			if (targetIndex < 0 || targetIndex >= questions.length) return prev;
			const tmp = questions[index];
			questions[index] = questions[targetIndex];
			questions[targetIndex] = tmp;
			return {
				...prev,
				questions: questions.map((q, i) => ({ ...q, sort_order: i + 1 })),
			};
		});
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={editingId ? "编辑问卷模板" : "新建问卷模板"}
				maxWidth={700}
			>
			{editMsg && (
				<div className="bg-destructive/10 text-destructive px-3.5 py-2.5 rounded-lg text-sm mb-4">
					{editMsg}
				</div>
			)}
			{isLoadingDetail && editingId ? (
				<LoadingState message="加载模板数据..." />
			) : (
				<form onSubmit={onSave} className="flex flex-col gap-4">
					<div>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							标题 *
						</label>
						<input
							value={form.title}
							onChange={(e) =>
								setForm((f) => ({ ...f, title: e.target.value }))
							}
							required
							placeholder="问卷标题"
							className={inputClass}
						/>
					</div>

					<div className="flex gap-3">
						<div className="flex-1">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								类型
							</label>
							<select
								value={form.type}
								onChange={(e) =>
									setForm((f) => ({ ...f, type: e.target.value }))
								}
								className={inputClass}
							>
								<option value="pre">前测 (pre)</option>
								<option value="post">后测 (post)</option>
							</select>
						</div>
						<div className="flex-1">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								状态
							</label>
							<div className="flex items-center gap-2 pt-2">
								<Switch
									checked={form.is_active}
									onCheckedChange={(checked) =>
										setForm((f) => ({ ...f, is_active: checked }))
									}
									aria-label="状态"
								/>
								<span className="text-sm text-muted-foreground">
									{form.is_active ? "启用" : "禁用"}
								</span>
							</div>
						</div>
					</div>

					<div>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							描述
						</label>
						<textarea
							rows={2}
							value={form.description}
							onChange={(e) =>
								setForm((f) => ({ ...f, description: e.target.value }))
							}
							placeholder="问卷说明（可选）"
							className={textareaClass}
						/>
					</div>

					<div className="border border-border rounded-lg p-4">
						<div className="flex items-center justify-between mb-3">
							<span className="text-sm font-semibold">
								题目列表 ({form.questions.length})
							</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={addQuestion}
							>
								<Plus size={14} /> 添加题目
							</Button>
						</div>

						{form.questions.length === 0 ? (
							<div className="text-center py-6 text-sm text-muted-foreground">
								暂无题目，点击上方按钮添加
							</div>
						) : (
							<div className="space-y-3">
								{form.questions.map((q, i) => (
									<div
										key={i}
										className="border border-border rounded-lg p-3 bg-muted/30"
									>
										<div className="flex items-center justify-between mb-2">
											<span className="text-xs font-semibold text-muted-foreground">
												第 {i + 1} 题
											</span>
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => moveQuestion(i, "up")}
													disabled={i === 0}
													className="p-0.5 rounded hover:bg-muted disabled:opacity-30 cursor-pointer border-none bg-transparent"
													title="上移"
												>
													<GripVertical
														size={14}
														className="text-muted-foreground"
													/>
												</button>
												<button
													type="button"
													onClick={() => moveQuestion(i, "down")}
													disabled={i === form.questions.length - 1}
													className="p-0.5 rounded hover:bg-muted disabled:opacity-30 cursor-pointer border-none bg-transparent"
													title="下移"
												>
													<ArrowLeft
														size={14}
														className="text-muted-foreground rotate-180"
													/>
												</button>
												<button
													type="button"
													onClick={() => removeQuestion(i)}
													className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer border-none bg-transparent"
													title="删除"
												>
													<X size={14} />
												</button>
											</div>
										</div>

										<div className="flex gap-3 mb-2">
											<div className="flex-1">
												<textarea
													rows={2}
													value={q.content}
													onChange={(e) =>
														updateQuestion(i, { content: e.target.value })
													}
													placeholder="题目内容"
													className={textareaClass}
												/>
											</div>
											<div className="w-40">
												<select
													value={q.question_type}
													onChange={(e) => {
														const newType = e.target.value;
														updateQuestion(i, {
															question_type: newType,
															options:
																newType === "multiple_choice" ? q.options : [],
														});
													}}
													className={inputClass}
												>
													{QUESTION_TYPE_OPTIONS.map((opt) => (
														<option key={opt.value} value={opt.value}>
															{opt.label}
														</option>
													))}
												</select>
											</div>
										</div>

										<div className="flex items-center gap-4">
											<label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
												<input
													type="checkbox"
													checked={q.required}
													onChange={(e) =>
														updateQuestion(i, { required: e.target.checked })
													}
													className="rounded"
												/>
												必答
											</label>
										</div>

										{q.question_type === "multiple_choice" && (
											<div className="mt-2">
												<label className="block text-xs text-muted-foreground mb-1">
													选项（一行一个）
												</label>
												<textarea
													rows={3}
													value={q.options.join("\n")}
													onChange={(e) =>
														updateQuestion(i, {
															options: e.target.value
																.split("\n")
																.filter((s) => s.trim()),
														})
													}
													placeholder={"选项A\n选项B\n选项C"}
													className={textareaClass}
												/>
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</div>

					<div className="flex gap-3 justify-end">
						<Button type="button" variant="outline" onClick={onClose}>
							取消
						</Button>
						<Button onClick={onSave} disabled={isSaving}>
							{isSaving ? (
								<>保存中...</>
							) : (
								<>
									<Save size={14} /> {editingId ? "保存修改" : "创建问卷"}
								</>
							)}
						</Button>
					</div>
				</form>
			)}
			</DialogContent>
		</Dialog>
	);
}
