import { BookOpen, ChevronDown } from "lucide-react";
import { useState } from "react";

interface Citation {
	source: string;
	section: string;
}

export default function CitationCard({ citations }: { citations: Citation[] }) {
	const [open, setOpen] = useState(false);

	if (!citations || citations.length === 0) return null;

	return (
		<div className="mt-3 border border-border rounded-lg overflow-hidden bg-card/50">
			<button
				type="button"
				className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer"
				onClick={() => setOpen(!open)}
			>
				<BookOpen size={12} />
				<span>参考教材 ({citations.length})</span>
				<ChevronDown
					size={12}
					className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div className="border-t border-border px-3 py-2 space-y-1.5">
					{citations.map((c, i) => (
						<div key={i} className="text-xs">
							<span className="font-medium text-foreground">{c.source}</span>
							<span className="text-muted-foreground"> › {c.section}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
