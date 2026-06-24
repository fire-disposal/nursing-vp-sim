import { BookOpen, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSectionText } from "@/api/api-client";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface Citation {
	source: string;
	section: string;
}

export default function CitationCard({ citations }: { citations: Citation[] }) {
	const [open, setOpen] = useState(false);
	const [modal, setModal] = useState<{ source: string; section: string } | null>(null);
	const [modalText, setModalText] = useState("");
	const [loadingModal, setLoadingModal] = useState(false);

	if (!citations || citations.length === 0) return null;

	const openModal = async (c: Citation) => {
		setModal({ source: c.source, section: c.section });
		setModalText("");
		setLoadingModal(true);
		try {
			const res = await getSectionText(c.source, c.section);
			setModalText(res.data.text || "");
		} catch {
			setModalText("无法加载教材原文");
		} finally {
			setLoadingModal(false);
		}
	};

	return (
		<>
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
							<button
								type="button"
								key={i}
								className="block w-full text-left text-xs hover:bg-primary/5 rounded px-1.5 py-1 -mx-1.5 transition-colors cursor-pointer"
								onClick={() => openModal(c)}
							>
								<span className="font-medium text-foreground">{c.source}</span>
								<span className="text-muted-foreground"> › {c.section}</span>
							</button>
						))}
					</div>
				)}
			</div>

			{modal && (
				<Dialog open onOpenChange={(o) => !o && setModal(null)}>
					<DialogContent maxWidth={768}>
						<div className="flex items-center gap-2 px-5 py-3 border-b border-border">
							<BookOpen size={14} className="text-primary" />
							<div className="flex-1 min-w-0">
								<span className="text-sm font-medium">{modal.source}</span>
								<span className="text-xs text-muted-foreground"> › {modal.section}</span>
							</div>
						</div>
						<div className="overflow-y-auto p-5 text-sm leading-relaxed">
							{loadingModal ? (
								<div className="flex items-center gap-2 text-muted-foreground">
									<Loader2 size={14} className="animate-spin" />
									加载中...
								</div>
							) : (
								<div className="[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:mb-1">
									<ReactMarkdown remarkPlugins={[remarkGfm]}>
										{modalText}
									</ReactMarkdown>
								</div>
							)}
						</div>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
