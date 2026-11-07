import { Modal } from "@mantine/core";
import AuthImage from "@/components/ui/auth-image";

/**
 * 反馈截图预览：管理页与学生页共用（同尺寸、同关闭语义）。
 * `url` 为空时不渲染，调用方无需自己判空。
 */
export function FeedbackImagePreview({ url, onClose }: { url: string | null; onClose: () => void }) {
	if (!url) return null;
	return (
		<Modal opened onClose={onClose} title="截图预览" size={800} centered withinPortal>
			<AuthImage
				src={url}
				alt="截图预览"
				style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: "var(--mantine-radius-md)" }}
			/>
		</Modal>
	);
}
