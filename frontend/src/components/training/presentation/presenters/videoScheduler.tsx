import { cn } from "@/lib/utils";
import { getBasePatientAvatar, getRealisticPatientAvatar } from "@/utils/avatar";
import type { EmotionState } from "@/stores/trainingStore";
import type { PatientPresenter, PresentationContext } from "../types";
import { renderAvatarImage } from "./shared";

/**
 * video — 视频调度器（预留实现）。
 *
 * 思路：AI 生成视频按情绪切成独立循环段（媒体流剪切），调度器随情绪切换段。
 * 激活方式：为病例填入 VIDEO_SOURCES 后自动启用；无源时 build 返回 null，
 * 策略链自动回退（realistic → static），生产环境无需任何代码改动。
 *
 * 源表结构：病例姓名 → 各情绪视频 URL。接入示例：
 *   const VIDEO_SOURCES = {
 *     "王建国": { neutral: "/videos/jianguo-neutral.mp4", anxious: "/videos/jianguo-anxious.mp4" },
 *   };
 */
const VIDEO_SOURCES: Record<string, Partial<Record<EmotionState, string>>> = {};

/** 媒体流剪切调度 — 情绪变化即切换视频段（key 变更强制重载，干净剪切）。 */
function VideoFace({
	sources,
	current,
	poster,
	alt,
	ctx,
}: {
	sources: Partial<Record<EmotionState, string>>;
	current: EmotionState;
	poster: string;
	alt: string;
	ctx: PresentationContext;
}) {
	const src = sources[current];
	if (!src) {
		// 该情绪无对应视频段 → poster（静态头像）兜底。
		return renderAvatarImage({ src: poster, alt }, ctx);
	}
	const shape = cn(
		"shrink-0 bg-muted object-cover",
		ctx.rounded === "full" ? "rounded-full ring-1 ring-border" : "rounded-2xl ring-1 ring-border",
		ctx.className,
	);
	return (
		<video
			key={src}
			src={src}
			poster={poster}
			autoPlay
			loop
			muted
			playsInline
			style={ctx.fill ? undefined : { width: ctx.size, height: ctx.size, objectFit: "cover" }}
			className={ctx.fill ? cn("w-full aspect-square", shape) : shape}
		/>
	);
}

export const videoSchedulerPresenter: PatientPresenter = {
	kind: "video",
	build(patient, emotion) {
		const sources = patient?.name ? VIDEO_SOURCES[patient.name] : undefined;
		if (!sources?.[emotion.emotion]) return null;
		return {
			kind: "video",
			alt: patient?.name ?? "患者",
			// 无视频段情绪用写实/简洁头像作 poster 兜底。
			poster: getRealisticPatientAvatar(patient?.name) ?? getBasePatientAvatar(patient),
			current: emotion.emotion,
			sources,
		};
	},
	render(payload, ctx) {
		if (payload.kind !== "video") return null;
		return (
			<VideoFace
				sources={payload.sources}
				current={payload.current}
				poster={payload.poster}
				alt={payload.alt}
				ctx={ctx}
			/>
		);
	},
};
