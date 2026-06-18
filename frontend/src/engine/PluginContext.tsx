import { createContext, type ReactNode, useContext, useState } from "react";

export type EmotionState =
	| "withdrawn"
	| "defensive"
	| "anxious"
	| "neutral"
	| "relaxed"
	| "open";

const EMOTION_BORDER: Record<EmotionState, string> = {
	withdrawn: "border-red-400",
	defensive: "border-orange-400",
	anxious: "border-purple-400",
	neutral: "border-border",
	relaxed: "border-blue-400",
	open: "border-green-400",
};

const EMOTION_COLOR: Record<EmotionState, string> = {
	withdrawn: "text-red-600",
	defensive: "text-orange-600",
	anxious: "text-purple-600",
	neutral: "text-muted-foreground",
	relaxed: "text-blue-600",
	open: "text-green-600",
};

export function getEmotionBorder(emotion: EmotionState): string {
	return EMOTION_BORDER[emotion] || EMOTION_BORDER.neutral;
}

export function getEmotionColor(emotion: EmotionState): string {
	return EMOTION_COLOR[emotion] || EMOTION_COLOR.neutral;
}

export const EMOTION_LABELS: Record<EmotionState, string> = {
	withdrawn: "沉默回避",
	defensive: "防御抵触",
	anxious: "焦虑不安",
	neutral: "正常配合",
	relaxed: "放松友好",
	open: "开放信任",
};

interface EmotionContextValue {
	emotion: EmotionState;
	setEmotion: (e: EmotionState) => void;
}
const EmotionCtx = createContext<EmotionContextValue>({
	emotion: "neutral",
	setEmotion: () => {},
});

export function EmotionProvider({ children }: { children: ReactNode }) {
	const [emotion, setEmotion] = useState<EmotionState>("neutral");
	return (
		<EmotionCtx.Provider value={{ emotion, setEmotion }}>
			{children}
		</EmotionCtx.Provider>
	);
}

export function useEmotion() {
	return useContext(EmotionCtx);
}

interface PortraitContextValue {
	portraitUrl: string | null;
	setPortraitUrl: (url: string | null) => void;
}
const PortraitCtx = createContext<PortraitContextValue>({
	portraitUrl: null,
	setPortraitUrl: () => {},
});

export function PortraitProvider({ children }: { children: ReactNode }) {
	const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
	return (
		<PortraitCtx.Provider value={{ portraitUrl, setPortraitUrl }}>
			{children}
		</PortraitCtx.Provider>
	);
}

export function usePortrait() {
	return useContext(PortraitCtx);
}
