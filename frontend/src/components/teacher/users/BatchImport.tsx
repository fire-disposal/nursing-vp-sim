import { AlertCircle, Download, FileText, Upload, Users } from "lucide-react";
import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import type { BatchUser, RoleOption } from "./types";

interface BatchImportProps {
	open: boolean;
	onClose: () => void;
	roles: RoleOption[];
	isImporting: boolean;
	onImport: (users: BatchUser[]) => void;
}

const btnPrimary =
	"inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-none cursor-pointer";

const btnSecondary =
	"inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors border-none cursor-pointer";

export default function BatchImport({
	open,
	onClose,
	roles,
	isImporting,
	onImport,
}: BatchImportProps) {
	const [batchText, setBatchText] = useState("");
	const [batchPreview, setBatchPreview] = useState<BatchUser[]>([]);
	const [batchParseError, setBatchParseError] = useState("");

	function resetState() {
		setBatchText("");
		setBatchPreview([]);
		setBatchParseError("");
	}

	function handleClose() {
		if (isImporting) return;
		resetState();
		onClose();
	}

	function parseBatchText(text: string) {
		setBatchParseError("");
		setBatchPreview([]);
		if (!text.trim()) {
			setBatchPreview([]);
			return;
		}
		const lines = text
			.trim()
			.split("\n")
			.filter((l) => l.trim());
		const users: BatchUser[] = [];
		for (let i = 0; i < lines.length; i++) {
			const parts = lines[i].split(",").map((s) => s.trim());
			if (parts.length < 4) {
				setBatchParseError(
					`第 ${i + 1} 行格式不正确，需要至少4列（用户名,密码,姓名,角色）`,
				);
				setBatchPreview([]);
				return;
			}
			const classIdRaw = parts[5] ? parts[5].trim() : "";
			const classId =
				classIdRaw && /^\d+$/.test(classIdRaw) ? Number(classIdRaw) : null;
			if (classIdRaw && !/^\d+$/.test(classIdRaw)) {
				setBatchParseError(
					`第 ${i + 1} 行班级ID "${classIdRaw}" 无效，应为数字`,
				);
				setBatchPreview([]);
				return;
			}
			users.push({
				username: parts[0],
				password: parts[1],
				display_name: parts[2],
				role: parts[3] || "student",
				student_id: parts[4] || null,
				class_id: classId,
			});
		}
		setBatchPreview(users);
	}

	function parseCSVFile(file: File) {
		setBatchParseError("");
		const reader = new FileReader();
		reader.onload = (e) => {
			const text = String(e.target?.result || "").replace(/^\uFEFF/, "");
			const lines = text
				.trim()
				.split("\n")
				.filter((l) => l.trim());
			if (lines.length <= 1) {
				parseBatchText(text);
				return;
			}
			const firstIsHeader = !/^\d/.test(lines[0]);
			parseBatchText(firstIsHeader ? lines.slice(1).join("\n") : text);
		};
		reader.readAsText(file);
	}

	function handleDownloadTemplate() {
		const csvContent =
			"\uFEFF用户名,密码,姓名,角色,学号,班级ID\nstudent6,123456,赵六,student,2024006,\nstudent7,123456,钱七,student,2024007,";
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "用户导入模板.csv";
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleImport() {
		if (batchPreview.length === 0) return;
		onImport(batchPreview);
	}

	return (
		<Modal
			open={open}
			onClose={handleClose}
			title={
				<>
					<Users size={20} /> 批量导入用户
				</>
			}
			maxWidth={650}
		>
			<div className="mb-3">
				<label className="font-semibold text-sm flex items-center gap-1.5 mb-2">
					<FileText size={14} /> 粘贴文本（每行一个用户，逗号分隔）
				</label>
				<textarea
					rows={5}
					placeholder="用户名,密码,姓名,角色,学号,班级ID\nstudent6,123456,赵六,student,2024006,1"
					value={batchText}
					onChange={(e) => {
						setBatchText(e.target.value);
						parseBatchText(e.target.value);
					}}
					className="w-full font-mono text-sm p-2 border border-border rounded-lg focus-ring"
					disabled={isImporting}
				/>
				<div className="text-xs text-muted-foreground mt-1">
					格式：用户名,密码,姓名,角色,学号,班级ID（可选）
				</div>
			</div>
			<div className="mb-3 flex items-center gap-3 flex-wrap">
				<label className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors cursor-pointer">
					<Upload size={14} /> 上传 CSV 文件
					<input
						type="file"
						accept=".csv"
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) {
								setBatchText("");
								parseCSVFile(f);
							}
							e.target.value = "";
						}}
						className="hidden"
						disabled={isImporting}
					/>
				</label>
				<span
					className="text-primary cursor-pointer font-medium hover:underline text-sm"
					onClick={handleDownloadTemplate}
				>
					<Download size={14} className="inline align-middle mr-0.5 -mt-0.5" />
					下载模板
				</span>
			</div>
			{batchParseError && (
				<div className="text-destructive text-sm mb-3 flex items-center gap-1.5">
					<AlertCircle size={16} /> {batchParseError}
				</div>
			)}
			{batchPreview.length > 0 && (
				<div className="mb-4">
					<div className="font-semibold text-sm mb-2">
						预览（{batchPreview.length} 名用户）
					</div>
					<div className="max-h-[200px] overflow-auto border border-border rounded-lg">
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										用户名
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										密码
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										姓名
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										角色
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										学号
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										班级ID
									</th>
								</tr>
							</thead>
							<tbody>
								{batchPreview.map((u, i) => (
									<tr key={i} className="hover:bg-muted">
										<td className="px-4 py-3 border-b border-border">
											{u.username}
										</td>
										<td className="px-4 py-3 border-b border-border">
											{"*".repeat(Math.min(u.password.length, 8))}
										</td>
										<td className="px-4 py-3 border-b border-border">
											{u.display_name}
										</td>
										<td className="px-4 py-3 border-b border-border">
											<span
												className={cn(
													"inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
													u.role === "super_admin" || u.role === "school_admin"
														? "bg-danger text-danger-foreground"
														: u.role === "teacher"
															? "bg-info text-info-foreground"
															: "bg-success text-success-foreground",
												)}
											>
												{roles.find((r) => r.name === u.role)?.display_name ||
													u.role}
											</span>
										</td>
										<td className="px-4 py-3 border-b border-border text-muted-foreground">
											{u.student_id || "-"}
										</td>
										<td className="px-4 py-3 border-b border-border text-muted-foreground">
											{u.class_id || "-"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
			<div className="flex gap-3 justify-end">
				<button
					className={btnSecondary}
					onClick={handleClose}
					disabled={isImporting}
				>
					取消
				</button>
				<button
					className={cn(
						btnPrimary,
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
					disabled={batchPreview.length === 0 || isImporting}
					onClick={handleImport}
				>
					{isImporting ? "导入中..." : `导入 ${batchPreview.length} 名用户`}
				</button>
			</div>
		</Modal>
	);
}
