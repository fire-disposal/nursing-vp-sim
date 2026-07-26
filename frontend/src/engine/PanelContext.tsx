import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";

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

interface PanelStateContextValue {
	emotion: EmotionState;
	setEmotion: (e: EmotionState) => void;
	trust: number;
	comfort: number;
	setTrustComfort: (trust: number, comfort: number) => void;
	portraitUrl: string | null;
	setPortraitUrl: (url: string | null) => void;
}

const PanelStateCtx = createContext<PanelStateContextValue>({
	emotion: "neutral",
	setEmotion: () => {},
	trust: 50,
	comfort: 50,
	setTrustComfort: () => {},
	portraitUrl: null,
	setPortraitUrl: () => {},
});

export function PanelStateProvider({ children }: { children: ReactNode }) {
	const [emotion, setEmotion] = useState<EmotionState>("neutral");
	const [trust, setTrust] = useState(50);
	const [comfort, setComfort] = useState(50);
	const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
	const setTrustComfort = (t: number, c: number) => { setTrust(t); setComfort(c); };
	const value = useMemo(
		() => ({ emotion, setEmotion, trust, comfort, setTrustComfort, portraitUrl, setPortraitUrl }),
		[emotion, trust, comfort, portraitUrl],
	);
	return (
		<PanelStateCtx.Provider value={value}>{children}</PanelStateCtx.Provider>
	);
}

export function useEmotion() {
	const ctx = useContext(PanelStateCtx);
	return { emotion: ctx.emotion, setEmotion: ctx.setEmotion, trust: ctx.trust, comfort: ctx.comfort, setTrustComfort: ctx.setTrustComfort };
}


/** 读 portraitUrl 状态 */
export function usePortrait() {
	const ctx = useContext(PanelStateCtx);
	return { portraitUrl: ctx.portraitUrl, setPortraitUrl: ctx.setPortraitUrl };
}
