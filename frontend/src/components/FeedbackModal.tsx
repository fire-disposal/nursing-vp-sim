import { ActionIcon, Box, Center, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconMessageCircle, IconPlus, IconSend, IconX } from "@tabler/icons-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { submitFeedbackFormData } from "@/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { compressImage, validateImageFile } from "@/lib/image-compress";

const RATING_META = [
	{ label: "很不满意", color: "red" },
	{ label: "不满意", color: "orange" },
	{ label: "一般", color: "yellow" },
	{ label: "满意", color: "teal" },
	{ label: "很满意", color: "green" },
] as const;

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
	const [images, setImages] = useState<{ file: File; url: string }[]>([]);
	const [compressing, setCompressing] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const urlsRef = useRef<string[]>([]);
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
			const entries = compressed.map((f) => {
				if (f.size > 512 * 1024) {
					throw new Error("图片压缩后仍超过 512KB 限制，请选择较小的图片");
				}
				const url = URL.createObjectURL(f);
				urlsRef.current.push(url);
				return { file: f, url };
			});
			setImages((prev) => [...prev, ...entries].slice(0, 3));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "图片处理失败，请重试");
		} finally {
			setCompressing(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const handleRemoveImage = (index: number) => {
		setImages((prev) => {
			const entry = prev[index];
			if (entry) URL.revokeObjectURL(entry.url);
			return prev.filter((_, i) => i !== index);
		});
	};

	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			const formData = new FormData();
			formData.append("rating", String(rating));
			formData.append("tag", tag);
			if (content) formData.append("content", content);
			for (const img of images) {
				formData.append("images", img.file);
			}
			await submitFeedbackFormData(formData);
			toast.success("感谢你的反馈！");
			setRating(3);
			setTag("");
			setContent("");
			clearImages();
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
		clearImages();
		onClose();
	};

	const clearImages = () => {
		for (const url of urlsRef.current) {
			URL.revokeObjectURL(url);
		}
		urlsRef.current = [];
		setImages([]);
	};

	useEffect(() => {
		return () => {
			for (const url of urlsRef.current) {
				URL.revokeObjectURL(url);
			}
		};
	}, []);

	return (
		<ResponsiveDialog open={open} onClose={handleClose} title="意见反馈" maxWidth={480}>
			<Stack gap="lg">
				<Box>
					<Text size="sm" fw={500} c="dimmed" mb="xs">
						整体评价{" "}
						<Text component="span" size="sm" fw={400} c="dimmed" opacity={0.6}>
							(选填)
						</Text>
					</Text>
					<Group gap={4} wrap="nowrap" justify="space-between">
						{RATING_META.map((meta, i) => {
							const val = i + 1;
							const active = rating === val;
							return (
								<UnstyledButton
									key={val}
									onClick={() => setRating(val)}
									style={{
										flex: 1,
										minWidth: 0,
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										gap: 4,
										padding: "8px 4px",
										borderRadius: "var(--mantine-radius-md)",
										border: active
											? `1px solid var(--mantine-color-${meta.color}-6)`
											: "1px solid transparent",
										background: active
											? `var(--mantine-color-${meta.color}-1)`
											: "transparent",
										cursor: "pointer",
									}}
								>
									<Text size="lg" fw={700} c={active ? `${meta.color}.7` : "dimmed"}>
										{val}
									</Text>
									<Text
										size="xs"
										fw={active ? 600 : 400}
										c={active ? `${meta.color}.7` : "dimmed"}
										style={{ whiteSpace: "nowrap" }}
									>
										{meta.label}
									</Text>
								</UnstyledButton>
							);
						})}
					</Group>
				</Box>

				<Box>
					<Text size="sm" fw={500} c="dimmed" mb="xs">
						反馈类型{" "}
						<Text component="span" size="sm" fw={400} c="dimmed" opacity={0.6}>
							(选填)
						</Text>
					</Text>
					<Group gap={8}>
						{tags.map((t) => (
							<Button
								key={t.value}
								variant={tag === t.value ? "default" : "outline"}
								size="sm"
								radius="xl"
								onClick={() => setTag(tag === t.value ? "" : t.value)}
							>
								{t.label}
							</Button>
						))}
					</Group>
				</Box>

				<Box>
					<Text size="sm" fw={500} c="dimmed" mb="xs">
						详细描述{" "}
						<Text component="span" size="sm" fw={400} c="dimmed" opacity={0.6}>
							(选填)
						</Text>
					</Text>
					<Textarea
						placeholder="请详细描述你的想法..."
						value={content}
						onChange={(e) => setContent(e.target.value)}
						rows={4}
					/>
				</Box>

				<Box>
					<Text size="sm" fw={500} c="dimmed" mb="xs">
						添加截图{" "}
						<Text component="span" size="sm" fw={400} c="dimmed" opacity={0.6}>
							(选填, 最多3张)
						</Text>
					</Text>
					<Group gap={8} wrap="wrap">
						{images.map((entry, i) => (
							<Box
								key={`${entry.file.name}-${i}`}
								style={{
									position: "relative",
									width: 64,
									height: 64,
									borderRadius: "var(--mantine-radius-md)",
									border: "1px solid var(--mantine-color-gray-3)",
									overflow: "hidden",
									flexShrink: 0,
								}}
							>
								<img
									src={entry.url}
									alt={`截图 ${i + 1}`}
									style={{ width: "100%", height: "100%", objectFit: "cover" }}
								/>
								<ActionIcon
									variant="filled"
									color="red"
									size="xs"
									onClick={() => handleRemoveImage(i)}
									aria-label={`删除截图 ${i + 1}`}
									style={{ position: "absolute", top: -4, right: -4, borderRadius: "50%" }}
								>
									<IconX size={12} />
								</ActionIcon>
							</Box>
						))}
						{compressing && (
							<Center
								style={{
									width: 64,
									height: 64,
									borderRadius: "var(--mantine-radius-md)",
									border: "1px solid var(--mantine-color-gray-3)",
									background: "var(--mantine-color-gray-1)",
								}}
							>
								<Loader size="sm" />
							</Center>
						)}
						{images.length < 3 && !compressing && (
							<Box
								component="label"
								style={{
									width: 64,
									height: 64,
									borderRadius: "var(--mantine-radius-md)",
									border: "1px dashed var(--mantine-color-gray-4)",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									gap: 2,
									cursor: "pointer",
									flexShrink: 0,
								}}
							>
								<IconPlus size={18} style={{ color: "var(--mantine-color-dimmed)" }} />
								<Text fz={10} c="dimmed">
									添加
								</Text>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									capture="environment"
									multiple
									style={{ display: "none" }}
									onChange={handleAddImages}
								/>
							</Box>
						)}
					</Group>
				</Box>
			</Stack>

			<Group justify="space-between" mt="xs" wrap="nowrap">
				<Button
					type="button"
					variant="link"
					size="xs"
					p={0}
					onClick={() => {
						onClose();
						navigate("/my-feedback");
					}}
				>
					<IconMessageCircle size={13} /> 查看我的反馈
				</Button>
				<Group gap={8}>
					<Button
						type="button"
						variant="outline"
						onClick={handleClose}
						disabled={submitting || compressing}
					>
						取消
					</Button>
					<Button
						type="button"
						onClick={handleSubmit}
						disabled={submitting || compressing}
					>
						{submitting ? (
							<>
								<Loader size={14} /> 提交中...
							</>
						) : (
							<>
								<IconSend size={14} /> 提交
							</>
						)}
					</Button>
				</Group>
			</Group>
		</ResponsiveDialog>
	);
}
