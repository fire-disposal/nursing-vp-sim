import { AlertCircle, Download, FileText, Upload, Users } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RoleBadge } from "@/components/ui/role-badge";
import { cn } from "@/utils/cn";
import { btnPrimary, btnSecondary } from "@/utils/styles";
import type { BatchUser, RoleOption } from "./types";

const CSV_HEADERS = ["用户名", "密码", "姓名", "角色", "学号", "班级ID"];
const BOM = "\uFEFF";

interface BatchImportProps {
	open: boolean;
	onClose: () => void;
	roles: RoleOption[];
	isImporting: boolean;
	onImport: (users: BatchUser[]) => void;
}

export default function BatchImport({ open, onClose, roles, isImporting, onImport }: BatchImportProps) {
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

	function parseLines(lines: string[]) {
		setBatchParseError("");
		setBatchPreview([]);

		if (lines.length === 0) return;

		// Detect header row: if first line contains CSV_HEADERS keywords
		const header = lines[0].split(",").map((s) => s.trim().replace(BOM, ""));
		const isHeader = CSV_HEADERS.some((h) => header.includes(h));
		const colMap: Record<string, number> = {};
		if (isHeader) {
			header.forEach((col, idx) => { colMap[col] = idx; });
			lines = lines.slice(1);
		}

		function getVal(col: string): string {
			if (isHeader && col in colMap) return lines[0]?.split(",")[colMap[col]]?.trim() || "";
			const pos = CSV_HEADERS.indexOf(col);
			return pos >= 0 ? (lines[0]?.split(",")[pos]?.trim() || "") : "";
		}

		const errors: string[] = [];
		const users: BatchUser[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim()) continue;

			const username = isHeader ? getVal("用户名") : (line.split(",")[0]?.trim() || "");
			const password = isHeader ? getVal("密码") : (line.split(",")[1]?.trim() || "");
			const displayName = isHeader ? getVal("姓名") : (line.split(",")[2]?.trim() || "");
			const role = isHeader ? getVal("角色") : (line.split(",")[3]?.trim() || "student");
			const studentId = isHeader ? getVal("学号") : (line.split(",")[4]?.trim() || "");
			const classIdRaw = isHeader ? getVal("班级ID") : (line.split(",")[5]?.trim() || "");

			const rowNum = i + 1;
			const locator = isHeader ? `第${rowNum}行` : `第${rowNum}行(${username || "?"})`;

			if (!username || !password || !displayName) {
				errors.push(`${locator}: 用户名/密码/姓名不能为空`);
				continue;
			}
			if (password.length < 6) {
				errors.push(`${locator}: 密码长度不能少于6位`);
				continue;
			}
			if (role !== "student") {
				errors.push(`${locator}: 仅支持学生角色（当前: ${role}）`);
				continue;
			}

			const classId = /^\d+$/.test(classIdRaw) ? Number(classIdRaw) : (classIdRaw ? null : null);
			if (classIdRaw && !classId) {
				errors.push(`${locator}: 班级ID "${classIdRaw}" 无效`);
				continue;
			}

			users.push({
				username, password, display_name: displayName, role: "student",
				student_id: studentId || null, class_id: classId || null,
			});
		}

		if (errors.length > 0) {
			setBatchParseError(errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n... 还有 ${errors.length - 10} 个错误` : ""));
		}
		if (users.length > 0) setBatchPreview(users);
	}

	function parseBatchText(text: string) {
		const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
		parseLines(lines);
	}

	function parseCSVFile(file: File) {
		setBatchParseError("");
		const reader = new FileReader();
		reader.onload = (e) => {
			if (!(e.target?.result instanceof ArrayBuffer)) return;
			const arr = new Uint8Array(e.target.result);
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(arr);
			} catch {
				text = new TextDecoder("gbk").decode(arr);
			}
			text = text.replace(/^\uFEFF/, "");
			const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
			parseLines(lines);
		};
		reader.readAsArrayBuffer(file);
	}

	function handleDownloadTemplate() {
		const csvContent = BOM + CSV_HEADERS.join(",") + "\n" +
			"student01,123456,张同学,student,S2024001,1\n" +
			"student02,myp@ss,李同学,student,S2024002,1\n";
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "学生导入模板.csv";
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleImport() {
		if (batchPreview.length === 0) return;
		onImport(batchPreview);
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
			<DialogContent title={<><Users size={20} /> 批量导入学生</>} maxWidth={650}>
			<div className="text-xs text-muted-foreground mb-3">
				支持 CSV 文件上传或直接粘贴文本。表头行自动识别，无表头按位置匹配。
				仅限创建<strong>学生</strong>角色账号，默认密码长度 ≥6 位。
			</div>
			<div className="mb-3">
				<label className="font-semibold text-sm flex items-center gap-1.5 mb-2">
					<FileText size={14} /> 粘贴文本（每行一个学生，逗号分隔）
				</label>
				<textarea
					rows={5}
					placeholder={`${CSV_HEADERS.join(",")}\nstudent01,123456,张同学,student,S2024001,1`}
					value={batchText}
					onChange={(e) => { setBatchText(e.target.value); parseBatchText(e.target.value); }}
					className="w-full font-mono text-sm p-2 border border-border rounded-lg focus-ring"
					disabled={isImporting}
				/>
				<div className="text-xs text-muted-foreground mt-1">
					列顺序：{CSV_HEADERS.join(" / ")}（班级ID 可选）
				</div>
			</div>
			<div className="mb-3 flex items-center gap-3 flex-wrap">
				<label className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors cursor-pointer">
					<Upload size={14} /> 上传 CSV 文件
					<input type="file" accept=".csv"
						onChange={(e) => { const f = e.target.files?.[0]; if (f) { setBatchText(""); parseCSVFile(f); } e.target.value = ""; }}
						className="hidden" disabled={isImporting} />
				</label>
				<span className="text-primary cursor-pointer font-medium hover:underline text-sm" onClick={handleDownloadTemplate}>
					<Download size={14} className="inline align-middle mr-0.5 -mt-0.5" />下载模板
				</span>
			</div>
			{batchParseError && (
				<div className="text-destructive text-xs mb-3 space-y-1 whitespace-pre-wrap bg-destructive/10 rounded-lg p-2 max-h-32 overflow-y-auto">
					{batchParseError.split("\n").map((e, i) => (
						<div key={i} className="flex items-start gap-1"><AlertCircle size={13} className="mt-0.5 shrink-0" />{e}</div>
					))}
				</div>
			)}
			{batchPreview.length > 0 && (
				<div className="mb-4">
					<div className="font-semibold text-sm mb-2">预览（{batchPreview.length} 名学生）</div>
					<div className="max-h-[200px] overflow-auto border border-border rounded-lg">
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr>
									{CSV_HEADERS.map((h) => (
										<th key={h} className="sticky top-0 z-10 text-left px-3 py-2 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">{h}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{batchPreview.map((u, i) => (
									<tr key={i} className="hover:bg-muted">
										<td className="px-3 py-2 border-b border-border">{u.username}</td>
										<td className="px-3 py-2 border-b border-border">{"*".repeat(Math.min(u.password.length, 8))}</td>
										<td className="px-3 py-2 border-b border-border">{u.display_name}</td>
										<td className="px-3 py-2 border-b border-border"><RoleBadge role={u.role} label={roles.find((r) => r.name === u.role)?.display_name || u.role} /></td>
										<td className="px-3 py-2 border-b border-border text-muted-foreground">{u.student_id || "-"}</td>
										<td className="px-3 py-2 border-b border-border text-muted-foreground">{u.class_id || "-"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
			<div className="flex gap-3 justify-end">
				<button className={btnSecondary} onClick={handleClose} disabled={isImporting}>取消</button>
				<button className={cn(btnPrimary, "disabled:opacity-50 disabled:cursor-not-allowed")}
					disabled={batchPreview.length === 0 || isImporting} onClick={handleImport}>
					{isImporting ? "导入中..." : `导入 ${batchPreview.length} 名学生`}
				</button>
			</div>
			</DialogContent>
		</Dialog>
	);
}
