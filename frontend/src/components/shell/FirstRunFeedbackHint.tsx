import { Box, Button, Paper, Stack, Text } from "@mantine/core";
import { IconMessageCirclePlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { queryKeys } from "@/api/query-keys";
import { getPublicAppSettings } from "@/api/settings";
import useAuthStore from "@/stores/authStore";

const DISMISSED_PREFIX = "nvp.feedback-hint.v1.";

/**
 * 首次进入的反馈引导：全屏压暗 + 挖出顶栏「反馈」按钮 + 小卡片指路。
 *
 * - 每个账号只出现一次（localStorage 按 user.id 记；换设备会再出现一次）。
 * - 遮罩由四块矩形拼成，**反馈按钮本身保持可点**；点它或「知道了」都会关闭并记已读。
 * - 只在 ManageShell 挂载（有顶栏反馈入口的常规页面）；沉浸训练壳没有该按钮，不展示。
 */
export default function FirstRunFeedbackHint() {
	const userId = useAuthStore((s) => s.user?.id);
	const [open, setOpen] = useState(false);
	const [rect, setRect] = useState<DOMRect | null>(null);
	const [target, setTarget] = useState<HTMLElement | null>(null);
	// 管理员可全站关闭；关闭后即便本地没记过也不出现。
	const { data: settings } = useQuery({
		queryKey: queryKeys.settings.public,
		queryFn: () => getPublicAppSettings().then((r) => r.data),
		staleTime: 60_000,
	});

	const dismiss = useCallback(() => {
		if (userId != null) localStorage.setItem(`${DISMISSED_PREFIX}${userId}`, "1");
		setOpen(false);
	}, [userId]);

	// 账号确定后延迟一拍（等顶栏挂载与字体布局），再决定是否出现。
	useEffect(() => {
		if (userId == null || settings?.feedback_hint_enabled !== true) return;
		if (localStorage.getItem(`${DISMISSED_PREFIX}${userId}`)) return;
		const timer = window.setTimeout(() => setOpen(true), 450);
		return () => window.clearTimeout(timer);
	}, [userId, settings?.feedback_hint_enabled]);

	// 找到当前可见的反馈按钮（桌面文字按钮 / 移动端图标各一个），并跟随窗口变化。
	useEffect(() => {
		if (!open) return;
		const find = () => {
			const candidates = Array.from(
				document.querySelectorAll<HTMLElement>("[data-feedback-button]"),
			);
			const visible = candidates.find((el) => el.getClientRects().length > 0);
			if (!visible) return;
			setTarget(visible);
			setRect(visible.getBoundingClientRect());
		};
		find();
		const onResize = () => find();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [open]);

	// 点反馈按钮：先收引导，再让按钮的 onClick 打开反馈弹窗（弹窗层级低于遮罩）。
	useEffect(() => {
		if (!open || !target) return;
		const onClick = () => dismiss();
		target.addEventListener("click", onClick, { once: true });
		return () => target.removeEventListener("click", onClick);
	}, [open, target, dismiss]);

	// 遮罩期间锁滚轮/滚动条；卸载即恢复。
	useEffect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [open]);

	if (!open || !rect) return null;

	const vw = window.innerWidth;
	const cardWidth = Math.min(300, vw - 24);
	const cardTop = rect.bottom + 14;
	const cardRight = Math.max(12, vw - rect.right);
	const shade = "rgba(15, 23, 42, 0.55)";

	return createPortal(
		<>
			{/* 四块遮罩把按钮区域挖空：视觉上是全屏压暗，交互上按钮仍可点。 */}
			<Box style={{ position: "fixed", inset: 0, zIndex: 1000, pointerEvents: "none" }}>
				{/* 四块遮罩必须自己接收指针事件（外层 none 只用于让出挖空区域），
				    否则视觉压暗但点击会穿透到页面。 */}
				<Box style={{ position: "absolute", left: 0, top: 0, width: "100%", height: rect.top, background: shade, pointerEvents: "auto", cursor: "default" }} />
				<Box style={{ position: "absolute", left: 0, top: rect.bottom, width: "100%", bottom: 0, background: shade, pointerEvents: "auto", cursor: "default" }} />
				<Box style={{ position: "absolute", left: 0, top: rect.top, width: rect.left, height: rect.height, background: shade, pointerEvents: "auto", cursor: "default" }} />
				<Box
					style={{
						position: "absolute",
						left: rect.right,
						top: rect.top,
						right: 0,
						height: rect.height,
						background: shade,
						pointerEvents: "auto",
						cursor: "default",
					}}
				/>
				<Box
					style={{
						position: "absolute",
						left: rect.left - 3,
						top: rect.top - 3,
						width: rect.width + 6,
						height: rect.height + 6,
						border: "2px solid var(--mantine-color-brand-5)",
						borderRadius: "var(--mantine-radius-md)",
						boxShadow: "0 0 0 4px var(--mantine-color-brand-light)",
					}}
				/>
			</Box>

			<Paper
				shadow="lg"
				radius="md"
				p="md"
				withBorder
				role="dialog"
				aria-modal="true"
				aria-labelledby="feedback-hint-title"
				style={{
					position: "fixed",
					top: cardTop,
					right: cardRight,
					width: cardWidth,
					zIndex: 1001,
				}}
			>
				{/* 指向右上角的按钮 */}
				<Box
					style={{
						position: "absolute",
						top: -5,
						right: 26,
						width: 10,
						height: 10,
						transform: "rotate(45deg)",
						background: "var(--mantine-color-body)",
						borderTop: "1px solid var(--mantine-color-default-border)",
						borderLeft: "1px solid var(--mantine-color-default-border)",
					}}
				/>
				<Stack gap={8}>
					<Text size="sm" fw={600} id="feedback-hint-title">
						有意见或建议？
					</Text>
					<Text size="xs" c="dimmed" lh={1.65}>
						点击右上角的「反馈」告诉开发者；回复会出现在「我的 → 我的反馈」里。
					</Text>
					<Button size="xs" onClick={dismiss} autoFocus leftSection={<IconMessageCirclePlus size={14} />}>
						知道了
					</Button>
				</Stack>
			</Paper>
		</>,
		document.body,
	);
}
