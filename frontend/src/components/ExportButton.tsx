import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";
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

	const doExport = async (fmt: string) => {
		setOpen(false);
		const params = new URLSearchParams();
		if (params) for (const [k, v] of Object.entries(params)) params.set(k, String(v));
		params.set("format", fmt);
		const resp = await api.post<Blob>(endpoint, null, { params, responseType: "blob" });
		const contentType = resp.headers["content-type"];
		const blob = new Blob([resp.data], { type: typeof contentType === "string" ? contentType : "application/octet-stream" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${filename}.${fmt}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	return (
		<div className="relative inline-flex items-center">
			<Button size="sm" onClick={() => doExport(format)}>
				<Download size={14} className="mr-1" />
				导出
			</Button>
			<button
				type="button"
				className="ml-px flex size-7 items-center justify-center rounded-r-md border border-input bg-background hover:bg-accent"
				onClick={() => setOpen(!open)}
				onBlur={() => setTimeout(() => setOpen(false), 150)}
			>
				<ChevronDown size={12} />
			</button>
			{open && (
				<div className="absolute right-0 top-full z-50 mt-1 w-24 rounded-md border bg-popover p-1 shadow-md">
					<button
						type="button"
						className={`flex w-full items-center rounded px-2 py-1 text-xs ${format === "csv" ? "bg-accent font-medium" : "hover:bg-accent"}`}
						onClick={() => { setFormat("csv"); doExport("csv"); }}
					>
						.CSV
					</button>
					<button
						type="button"
						className={`flex w-full items-center rounded px-2 py-1 text-xs ${format === "xlsx" ? "bg-accent font-medium" : "hover:bg-accent"}`}
						onClick={() => { setFormat("xlsx"); doExport("xlsx"); }}
					>
						.XLSX
					</button>
				</div>
			)}
		</div>
	);
}
