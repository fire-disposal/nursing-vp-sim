import { ChevronDown, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import Button from "@/components/ui/button";

interface ExportButtonProps {
	endpoint: string;
	filename: string;
	params?: Record<string, unknown>;
}

export default function ExportButton({ endpoint, filename, params }: ExportButtonProps) {
	const [format, setFormat] = useState<"csv" | "xlsx">("csv");
	const [open, setOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, []);

	const doExport = useCallback(async (fmt: string) => {
		setOpen(false);
		setExporting(true);
		try {
			const sp = new URLSearchParams();
			if (params) for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
			sp.set("format", fmt);
			const resp = await api.post<Blob>(endpoint, null, { params: sp, responseType: "blob" });
			const contentType = resp.headers["content-type"];
			const blob = new Blob([resp.data], {
				type: typeof contentType === "string" ? contentType : "application/octet-stream",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${filename}.${fmt}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} finally {
			setExporting(false);
		}
	}, [endpoint, filename, params]);

	return (
		<div className="relative inline-flex items-center" ref={menuRef}>
			<Button size="sm" onClick={() => doExport(format)} disabled={exporting}>
				{exporting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Download size={14} className="mr-1" />}
				{exporting ? "导出中..." : "导出"}
			</Button>
			<button
				type="button"
				disabled={exporting}
				className="ml-0.5 flex size-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
				onClick={() => setOpen((v) => !v)}
				aria-label="选择导出格式"
			>
				<ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
			</button>
			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div className="absolute right-0 top-full z-50 mt-1 w-28 animate-in fade-in slide-in-from-top-1 rounded-lg border bg-popover p-1 shadow-lg duration-150">
						<button
							type="button"
							className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
								format === "csv" ? "bg-accent font-medium text-accent-foreground" : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
							}`}
							onClick={() => { setFormat("csv"); doExport("csv"); }}
						>
							.CSV
							{format === "csv" && <Download size={11} className="opacity-60" />}
						</button>
						<button
							type="button"
							className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
								format === "xlsx" ? "bg-accent font-medium text-accent-foreground" : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
							}`}
							onClick={() => { setFormat("xlsx"); doExport("xlsx"); }}
						>
							.XLSX
							{format === "xlsx" && <Download size={11} className="opacity-60" />}
						</button>
					</div>
				</>
			)}
		</div>
	);
}
