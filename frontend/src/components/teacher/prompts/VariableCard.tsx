import { useState } from "react";
import { cn } from "@/lib/utils";
import type { VariableMeta } from "./types";

interface VariableCardProps {
	vName: string;
	meta: VariableMeta;
	onUpdateDesc: (vName: string, desc: string) => void;
	onUpdateDefault: (vName: string, defaultValue: string) => void;
	onUpdateSource: (vName: string, source: string) => void;
}

export default function VariableCard({
	vName,
	meta,
	onUpdateDesc,
	onUpdateDefault,
	onUpdateSource,
}: VariableCardProps) {
	const [editing, setEditing] = useState(false);
	const [descDraft, setDescDraft] = useState(meta.desc || "");
	const [editingDefault, setEditingDefault] = useState(false);
	const [defaultDraft, setDefaultDraft] = useState(meta.default_value || "");
	const [editingSource, setEditingSource] = useState(false);
	const [sourceDraft, setSourceDraft] = useState(meta.source || "");

	const isSystem =
		meta.source &&
		(meta.source.includes("病例数据") ||
			meta.source.includes("运行时") ||
			meta.source.includes("prompt_static") ||
			meta.source.includes("自动生成") ||
			meta.source.includes("Message 表"));

	const commitDesc = () => {
		setEditing(false);
		if (descDraft !== (meta.desc || "")) {
			onUpdateDesc(vName, descDraft);
		}
	};

	const commitDefault = () => {
		setEditingDefault(false);
		if (defaultDraft !== (meta.default_value || "")) {
			onUpdateDefault(vName, defaultDraft);
		}
	};

	const commitSource = () => {
		setEditingSource(false);
		if (sourceDraft !== (meta.source || "")) {
			onUpdateSource(vName, sourceDraft);
		}
	};

	return (
		<div className="border border-border rounded-lg p-2 bg-muted">
			<div className="flex items-center justify-between mb-1">
				<code className="text-sm font-semibold text-blue-700 dark:text-blue-400">
					{"{#}"}
					{vName}
					{"#}"}
				</code>
				<div className="flex items-center gap-1">
					{isSystem && (
						<span className="text-[0.625rem] bg-amber-100 text-amber-700 px-1 rounded-full leading-[17px] whitespace-nowrap dark:bg-amber-900/30 dark:text-amber-300">
							系统注入
						</span>
					)}
					<span className="text-xs text-muted-foreground/70 bg-gray-100 px-1.5 rounded-full dark:bg-gray-800">
						{meta.type || "string"}
					</span>
				</div>
			</div>

			{editing ? (
				<div className="mb-1">
					<input
						value={descDraft}
						onChange={(e) => setDescDraft(e.target.value)}
						onBlur={commitDesc}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitDesc();
						}}
						autoFocus
						placeholder="变量描述..."
						className="w-full text-xs py-0.5 px-1.5 border border-blue-300 rounded outline-none dark:border-blue-700 dark:bg-card"
					/>
				</div>
			) : (
				<div
					onClick={() => setEditing(true)}
					className={cn(
						"text-xs mb-1 cursor-pointer py-0.5",
						meta.desc
							? "text-muted-foreground not-italic"
							: "text-muted-foreground/70 italic",
					)}
					title="点击编辑描述"
				>
					{meta.desc || "点击添加描述..."}
				</div>
			)}

			<div className="text-xs text-muted-foreground/70 leading-relaxed">
				{editingSource ? (
					<div className="mb-0.5">
						<input
							value={sourceDraft}
							onChange={(e) => setSourceDraft(e.target.value)}
							onBlur={commitSource}
							onKeyDown={(e) => {
								if (e.key === "Enter") commitSource();
							}}
							autoFocus
							placeholder="变量来源..."
							className="w-full text-xs py-0.5 px-1.5 border border-amber-300 rounded outline-none dark:border-amber-700 dark:bg-card"
						/>
					</div>
				) : (
					<div
						onClick={() => setEditingSource(true)}
						className={cn(
							"cursor-pointer",
							meta.source
								? "text-muted-foreground not-italic"
								: "text-muted-foreground/70 italic",
						)}
						title="点击编辑来源说明"
					>
						{meta.source ? `来源：${meta.source}` : "点击添加来源说明..."}
					</div>
				)}
				{meta.example && (
					<div className="whitespace-pre-wrap max-h-[60px] overflow-hidden">
						示例：{meta.example}
					</div>
				)}
				<div className="mt-0.5">
					{isSystem ? (
						<div className="text-xs text-muted-foreground/70 italic">
							默认值：由系统运行时注入，不可编辑
						</div>
					) : editingDefault ? (
						<input
							value={defaultDraft}
							onChange={(e) => setDefaultDraft(e.target.value)}
							onBlur={commitDefault}
							onKeyDown={(e) => {
								if (e.key === "Enter") commitDefault();
							}}
							autoFocus
							placeholder="默认值..."
							className="w-full text-xs py-0.5 px-1.5 border border-green-300 rounded outline-none dark:border-green-700 dark:bg-card"
						/>
					) : (
						<div
							onClick={() => setEditingDefault(true)}
							className={cn(
								"cursor-pointer",
								meta.default_value
									? "text-muted-foreground not-italic"
									: "text-muted-foreground/70 italic",
							)}
							title="点击设置默认值（自定义变量在调用点未提供值时使用）"
						>
							默认值：{meta.default_value || "(点击设置)"}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
