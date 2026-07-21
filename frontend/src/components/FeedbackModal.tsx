import { Loader2, MessageSquare, Plus, Send, X } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { submitFeedbackFormData } from "@/api";
import { useToast } from "@/components/Toast";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { compressImage, validateImageFile } from "@/lib/image-compress";
import { cn } from "@/utils/cn";

const RATING_LABELS = ["很不满意", "不满意", "一般", "满意", "很满意"];
const RATING_COLORS = [
	"hover:border-red-400 data-[active=true]:border-red-500 data-[active=true]:bg-red-50 data-[active=true]:text-red-600",
	"hover:border-orange-400 data-[active=true]:border-orange-500 data-[active=true]:bg-orange-50 data-[active=true]:text-orange-600",
	"hover:border-amber-400 data-[active=true]:border-amber-500 data-[active=true]:bg-amber-50 data-[active=true]:text-amber-600",
	"hover:border-emerald-400 data-[active=true]:border-emerald-500 data-[active=true]:bg-emerald-50 data-[active=true]:text-emerald-600",
	"hover:border-green-400 data-[active=true]:border-green-500 data-[active=true]:bg-green-50 data-[active=true]:text-green-600",
];

interface Tag {
	value: string;
	label: string;
}

const tags: Tag[] = [
	{ value: "feature", label: "功能建议" },
	{ value: "bug", label: "BUG反馈" },
	{ value: "experience", label: "体验评价" },
	{ value: "content", label: "内容质量" },
	{ value: "ui", label: "界面设计" },
	{ value: "other", label: "其他" },
];

interface FeedbackModalProps {
	open: boolean;
	onClose: () => void;
	onSubmitted?: () => void;
}

export default function FeedbackModal({ open, onClose, onSubmitted }: FeedbackModalProps) {
	const [rating, setRating] = useState(3);
	const [tag, setTag] = useState("");
	const [content, setContent] = useState("");
	const [images, setImages] = useState<File[]>([]);
	const [compressing, setCompressing] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const toast = useToast();
	const navigate = useNavigate();

	const handleAddImages = async (e: ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;

		const newFiles = Array.from(files).slice(0, 3 - images.length);
		for (const file of newFiles) {
			const error = validateImageFile(file);
			if (error) {
				toast.error(error);
				return;
			}
		}

		setCompressing(true);
		try {
			const compressed = await Promise.all(newFiles.map(compressImage));
			setImages((prev) => [...prev, ...compressed].slice(0, 3));
		} catch {
			toast.error("图片处理失败，请重试");
		} finally {
			setCompressing(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const handleRemoveImage = (index: number) => {
		setImages((prev) => prev.filter((_, i) => i !== index));
	};

	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			const formData = new FormData();
			formData.append("rating", String(rating));
			formData.append("tag", tag);
			if (content) formData.append("content", content);
			for (const img of images) {
				formData.append("images", img);
			}
			await submitFeedbackFormData(formData);
			toast.success("感谢你的反馈！");
			setRating(3);
			setTag("");
			setContent("");
			setImages([]);
			onClose();
			if (onSubmitted) onSubmitted();
		} catch {
			toast.error("提交失败，请重试");
		} finally {
			setSubmitting(false);
		}
	};

	const handleClose = () => {
		if (submitting) return;
		setRating(3);
		setTag("");
		setContent("");
		setImages([]);
		onClose();
	};

	return (
		<ResponsiveDialog open={open} onClose={handleClose} title="意见反馈" maxWidth={480}>
			<div className="flex flex-col gap-5">
				<div>
					<div className="text-sm text-muted-foreground mb-3 font-medium">
						整体评价 <span className="text-muted-foreground/60 font-normal">(选填)</span>
					</div>
					<div className="flex justify-between gap-1 flex-nowrap">
						{[1, 2, 3, 4, 5].map((val) => (
							<button
								type="button"
								key={val}
								onClick={() => setRating(val)}
								data-active={rating === val}
								className={cn(
									"flex flex-col items-center gap-1 py-2 px-1 rounded-md border-2 cursor-pointer transition-all duration-150 min-w-0 flex-1",
									RATING_COLORS[val - 1],
									rating === val
										? "scale-105"
										: "border-transparent bg-transparent text-muted-foreground/60",
								)}
							>
								<span className={cn(
									"text-xl font-bold transition-all",
									rating === val ? "" : "",
								)}>
									{val}
								</span>
								<span className={cn(
									"text-[10px] sm:text-xs whitespace-nowrap",
									rating === val ? "font-semibold" : "",
								)}>
									{RATING_LABELS[val - 1]}
								</span>
							</button>
						))}
					</div>
				</div>

				<div>
					<div className="text-sm text-muted-foreground mb-3 font-medium">
						反馈类型 <span className="text-muted-foreground/60 font-normal">(选填)</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{tags.map((t) => (
							<button
								type="button"
								key={t.value}
								onClick={() => setTag(tag === t.value ? "" : t.value)}
								className={cn(
									"py-1 px-2.5 sm:px-3 rounded-full border text-sm cursor-pointer transition-all duration-150",
									tag === t.value
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-card text-muted-foreground",
								)}
							>
								{t.label}
							</button>
						))}
					</div>
				</div>

				<div>
					<div className="text-sm text-muted-foreground mb-3 font-medium">
						详细描述 <span className="text-muted-foreground/60 font-normal">(选填)</span>
					</div>
					<textarea
						placeholder="请详细描述你的想法..."
						value={content}
						onChange={(e) => setContent(e.target.value)}
						rows={4}
						className="w-full p-3 rounded-md border border-border text-sm resize-y outline-none box-border transition-colors duration-150 bg-card focus:border-primary"
					/>
				</div>

				<div>
					<div className="text-sm text-muted-foreground mb-3 font-medium">
						添加截图 <span className="text-muted-foreground/60 font-normal">(选填, 最多3张)</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{images.map((file, i) => (
							<div key={`${file.name}-${i}`} className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-md border border-border overflow-hidden group shrink-0">
								<img
									src={URL.createObjectURL(file)}
									alt={`截图 ${i + 1}`}
									className="w-full h-full object-cover"
								/>
								<button
									type="button"
									onClick={() => handleRemoveImage(i)}
									className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
									aria-label={`删除截图 ${i + 1}`}
								>
									<X size={12} />
								</button>
							</div>
						))}
						{compressing && (
							<div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md border border-border bg-muted flex items-center justify-center shrink-0">
								<Loader2 size={18} className="animate-spin text-muted-foreground" />
							</div>
						)}
						{images.length < 3 && (
							<label className="w-16 h-16 sm:w-20 sm:h-20 rounded-md border border-dashed border-border bg-card flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-primary transition-colors shrink-0">
								<Plus size={18} className="text-muted-foreground" />
								<span className="text-[10px] text-muted-foreground">添加</span>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									multiple
									className="hidden"
									onChange={handleAddImages}
								/>
							</label>
						)}
					</div>
				</div>
			</div>

			<div className="flex justify-between items-center mt-2">
				<button type="button" onClick={() => { onClose(); navigate("/my-feedback"); }}
					className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
					<MessageSquare size={13} /> 查看我的反馈
				</button>
				<div className="flex gap-2">
				<button
					type="button"
					onClick={handleClose}
					disabled={submitting || compressing}
					className="px-5 py-2 rounded-md border border-border bg-card text-muted-foreground text-sm font-medium cursor-pointer transition-colors duration-150"
				>
					取消
				</button>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={submitting || compressing}
					className={cn(
						"px-5 py-2 rounded-md border-none cursor-pointer text-sm font-medium text-white flex items-center gap-1 transition-colors duration-150",
						submitting ? "bg-muted opacity-60 cursor-not-allowed" : "bg-primary",
					)}
				>
					{submitting ? (<><Loader2 size={14} className="animate-spin" /> 提交中...</>) : (<><Send size={14} /> 提交</>)}
				</button>
			</div>
			</div>
		</ResponsiveDialog>
	);
}
