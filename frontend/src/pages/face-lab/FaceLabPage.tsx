import { useEffect, useMemo, useState } from "react";
import PremiumFaceArtwork from "@/components/training/face/PremiumFaceArtwork";
import {
	faceConfigFrom4D,
	type EmotionValues,
	type FaceConfig,
} from "@/components/training/face/expressionMap";
import {
	premiumExtrasFrom4D,
	type PremiumExtras,
} from "@/components/training/face/premiumExtras";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EMOTION_4D_LABELS, type Emotion4DLabel } from "@/stores/trainingStore";
import { cn } from "@/lib/utils";
import { EASINGS, type EasingName } from "./animation";
import { useAnimatedFace } from "./useAnimatedFace";

/**
 * FaceLabPage — 临时面部系统调整控制台（路由 /face-demo）。
 *
 * 实验目的：过渡动画（数值插值 + 离散切换）+ 参数化控制（4D 数值、
 * 标签预设、高级参数手动覆盖）。非生产页面，不接 store。
 */

const LABELS: Emotion4DLabel[] = [
	"open_trusting",
	"trusting_anxious",
	"irritated",
	"anxious_cooperative",
	"anxious_guarded",
	"withdrawn",
	"defensive",
	"relaxed",
	"neutral",
];

const PRESETS: Record<Emotion4DLabel, EmotionValues> = {
	open_trusting: { trust: 0.8, anxiety: 0.2, irritation: 0.1, cooperation: 0.8 },
	trusting_anxious: { trust: 0.75, anxiety: 0.65, irritation: 0.15, cooperation: 0.6 },
	irritated: { trust: 0.3, anxiety: 0.2, irritation: 0.8, cooperation: 0.3 },
	anxious_cooperative: { trust: 0.6, anxiety: 0.75, irritation: 0.2, cooperation: 0.7 },
	anxious_guarded: { trust: 0.4, anxiety: 0.75, irritation: 0.3, cooperation: 0.4 },
	withdrawn: { trust: 0.2, anxiety: 0.5, irritation: 0.2, cooperation: 0.2 },
	defensive: { trust: 0.25, anxiety: 0.4, irritation: 0.5, cooperation: 0.3 },
	relaxed: { trust: 0.7, anxiety: 0.2, irritation: 0.15, cooperation: 0.7 },
	neutral: { trust: 0.5, anxiety: 0.3, irritation: 0.2, cooperation: 0.6 },
};

type Overrides = Partial<FaceConfig & PremiumExtras>;

function RangeRow({
	label,
	value,
	min,
	max,
	step,
	disabled,
	display,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	disabled?: boolean;
	display?: string;
	onChange: (v: number) => void;
}) {
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span className="font-mono">{display ?? value}</span>
			</div>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(Number(e.target.value))}
				className="w-full accent-primary disabled:opacity-40"
			/>
		</div>
	);
}

function ToggleRow({
	label,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between py-1">
			<span className="text-xs text-muted-foreground">{label}</span>
			<Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
		</div>
	);
}

const DIM_LABELS: Array<{ key: keyof EmotionValues; name: string; cls: string }> = [
	{ key: "trust", name: "信任", cls: "bg-success-foreground" },
	{ key: "anxiety", name: "焦虑", cls: "bg-purple-500" },
	{ key: "irritation", name: "烦躁", cls: "bg-orange-500" },
	{ key: "cooperation", name: "配合", cls: "bg-blue-500" },
];

export default function FaceLabPage() {
	const [label, setLabel] = useState<Emotion4DLabel>("neutral");
	const [values, setValues] = useState<EmotionValues>({ ...PRESETS.neutral });
	const [duration, setDuration] = useState(600);
	const [easing, setEasing] = useState<EasingName>("easeOut");
	const [autoCycle, setAutoCycle] = useState(false);
	const [manual, setManual] = useState(false);
	const [overrides, setOverrides] = useState<Overrides>({});

	const derivedCfg = useMemo(() => faceConfigFrom4D(label, values), [label, values]);
	const derivedExtras = useMemo(() => premiumExtrasFrom4D(label, values), [label, values]);

	const targetCfg = useMemo(
		() => (manual ? { ...derivedCfg, ...overrides } : derivedCfg),
		[manual, derivedCfg, overrides],
	);
	const targetExtras = useMemo(
		() => (manual ? { ...derivedExtras, ...overrides } : derivedExtras),
		[manual, derivedExtras, overrides],
	);

	const display = useAnimatedFace(targetCfg, targetExtras, duration, easing);

	useEffect(() => {
		if (!autoCycle) return;
		const id = setInterval(() => {
			setLabel((prev) => LABELS[(LABELS.indexOf(prev) + 1) % LABELS.length]);
		}, 4000);
		return () => clearInterval(id);
	}, [autoCycle]);

	const pickLabel = (l: Emotion4DLabel) => {
		setLabel(l);
		setValues({ ...PRESETS[l] });
	};

	const toggleManual = (on: boolean) => {
		setManual(on);
		if (on) {
			setOverrides({ ...derivedCfg, ...derivedExtras });
		}
	};

	const set4D = (key: keyof EmotionValues, pct: number) => {
		setValues((prev) => ({ ...prev, [key]: pct / 100 }));
	};

	const setOverride = <K extends keyof Overrides>(key: K, v: NonNullable<Overrides[K]>) => {
		setOverrides((prev) => ({ ...prev, [key]: v }));
	};

	const mouthSelect = (
		<Select
			value={targetCfg.mouth}
			onValueChange={(v) => setOverride("mouth", v as FaceConfig["mouth"])}
		>
			<SelectTrigger className="h-8 text-xs">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{(["smile", "flat", "frown", "tight", "open"] as const).map((m) => (
					<SelectItem key={m} value={m}>
						{m}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	const irisSelect = (
		<Select
			value={targetExtras.irisShift}
			onValueChange={(v) => setOverride("irisShift", v as PremiumExtras["irisShift"])}
		>
			<SelectTrigger className="h-8 text-xs">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{(["center", "down", "away"] as const).map((s) => (
					<SelectItem key={s} value={s}>
						{s}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="mx-auto max-w-6xl space-y-6">
				<header>
					<h1 className="text-2xl font-bold">面部系统调整控制台</h1>
					<p className="text-sm text-muted-foreground">
						临时路由 /face-demo — 实验性过渡动画与参数化控制，不接生产 store
					</p>
				</header>

				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
					{/* ── 预览 ── */}
					<Card>
						<CardContent className="flex flex-col items-center gap-3 pt-6">
							<PremiumFaceArtwork
								cfg={display.cfg}
								extras={display.extras}
								size={220}
							/>
							<div className="flex items-center gap-2">
								<Badge variant="secondary">{EMOTION_4D_LABELS[label]}</Badge>
								<span className="font-mono text-[10px] text-muted-foreground">
									{label} · {duration}ms · {easing}
								</span>
							</div>
							<div className="w-full space-y-1">
								{DIM_LABELS.map((d) => (
									<div key={d.key} className="flex items-center gap-2 text-[10px]">
										<span className="w-6 text-muted-foreground">{d.name}</span>
										<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
											<div
												className={cn("h-full rounded-full transition-all", d.cls)}
												style={{ width: `${Math.round(values[d.key] * 100)}%` }}
											/>
										</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>

					<div className="space-y-6">
						{/* ── 情绪标签 + 4D ── */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">情绪状态</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex flex-wrap gap-1.5">
									{LABELS.map((l) => (
										<button
											key={l}
											onClick={() => pickLabel(l)}
											className={cn(
												"rounded-full border px-2.5 py-1 text-xs transition-colors",
												l === label
													? "border-primary bg-primary/10 text-primary"
													: "border-border text-muted-foreground hover:bg-muted",
											)}
										>
											{EMOTION_4D_LABELS[l]}
										</button>
									))}
								</div>
								{DIM_LABELS.map((d) => (
									<RangeRow
										key={d.key}
										label={d.name}
										value={Math.round(values[d.key] * 100)}
										min={0}
										max={100}
										step={1}
										display={`${Math.round(values[d.key] * 100)}`}
										onChange={(v) => set4D(d.key, v)}
									/>
								))}
							</CardContent>
						</Card>

						{/* ── 过渡动画实验 ── */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">过渡动画实验</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								<RangeRow
									label="过渡时长"
									value={duration}
									min={0}
									max={1500}
									step={50}
									display={`${duration}ms`}
									onChange={setDuration}
								/>
								<div className="space-y-1">
									<Label className="text-xs text-muted-foreground">缓动曲线</Label>
									<Select value={easing} onValueChange={(v) => setEasing(v as EasingName)}>
										<SelectTrigger className="h-8 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{(Object.keys(EASINGS) as EasingName[]).map((e) => (
												<SelectItem key={e} value={e}>
													{e}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<ToggleRow
									label="自动轮播 9 态（4s/态）"
									checked={autoCycle}
									onChange={setAutoCycle}
								/>
							</CardContent>
						</Card>

						{/* ── 高级参数 ── */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm flex items-center justify-between">
									<span>高级参数（手动覆盖）</span>
									<Switch checked={manual} onCheckedChange={toggleManual} />
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<RangeRow
										label="browAngle（眉）"
										value={targetCfg.browAngle}
										min={-1}
										max={1}
										step={0.05}
										disabled={!manual}
										display={targetCfg.browAngle.toFixed(2)}
										onChange={(v) => setOverride("browAngle", v)}
									/>
									<RangeRow
										label="eyeOpenness（眼开合 %）"
										value={targetCfg.eyeOpenness}
										min={0}
										max={1}
										step={0.01}
										disabled={!manual}
										display={`${Math.round(targetCfg.eyeOpenness * 100)}`}
										onChange={(v) => setOverride("eyeOpenness", v)}
									/>
									<RangeRow
										label="headTilt（头倾角）"
										value={targetExtras.headTilt}
										min={-6}
										max={6}
										step={0.5}
										disabled={!manual}
										display={targetExtras.headTilt.toFixed(1)}
										onChange={(v) => setOverride("headTilt", v)}
									/>
									<RangeRow
										label="eyeLid（上睑压力）"
										value={targetExtras.eyeLid}
										min={0}
										max={1}
										step={0.05}
										disabled={!manual}
										display={targetExtras.eyeLid.toFixed(2)}
										onChange={(v) => setOverride("eyeLid", v)}
									/>
								</div>
								<div className="flex items-end gap-4">
									<div className="flex-1 space-y-1">
										<span className="text-xs text-muted-foreground">嘴型</span>
										<div className={cn(!manual && "pointer-events-none opacity-40")}>
											{mouthSelect}
										</div>
									</div>
									<div className="flex-1 space-y-1">
										<span className="text-xs text-muted-foreground">虹膜朝向</span>
										<div className={cn(!manual && "pointer-events-none opacity-40")}>
											{irisSelect}
										</div>
									</div>
								</div>
								<div className="grid grid-cols-2 gap-x-6">
									<ToggleRow label="颊红" checked={targetCfg.blush} disabled={!manual} onChange={(v) => setOverride("blush", v)} />
									<ToggleRow label="泪痕" checked={targetCfg.tears} disabled={!manual} onChange={(v) => setOverride("tears", v)} />
									<ToggleRow label="汗滴" checked={targetExtras.sweat} disabled={!manual} onChange={(v) => setOverride("sweat", v)} />
									<ToggleRow label="皱眉纹" checked={targetExtras.furrow} disabled={!manual} onChange={(v) => setOverride("furrow", v)} />
								</div>
							</CardContent>
						</Card>
					</div>
				</div>

				{/* ── 静态参考网格 ── */}
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">9 态静态参考（默认映射）</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
							{LABELS.map((l) => (
								<div key={l} className="flex flex-col items-center gap-1">
									<PremiumFaceArtwork
										cfg={faceConfigFrom4D(l, PRESETS[l])}
										extras={premiumExtrasFrom4D(l, PRESETS[l])}
										size={84}
									/>
									<span className="text-[10px] text-muted-foreground">{EMOTION_4D_LABELS[l]}</span>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
