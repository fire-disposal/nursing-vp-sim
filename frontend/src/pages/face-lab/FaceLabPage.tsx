import { useEffect, useMemo, useState } from "react";
import { Box, Container, Grid, Group, Progress, SimpleGrid, Slider, Stack, Text, Title } from "@mantine/core";
import PremiumFaceArtwork from "@/components/training/face/PremiumFaceArtwork";
import { appearanceFor, type AgeGroup, type Gender } from "@/components/training/face/appearance";
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
import Button from "@/components/ui/button";
import { EMOTION_4D_LABELS, type Emotion4DLabel } from "@/stores/trainingStore";
import { EASINGS, type EasingName } from "./animation";
import { useAnimatedFace } from "./useAnimatedFace";

/**
 * FaceLabPage — 临时面部系统调整控制台（路由 /face-demo）。
 * 实验性过渡动画与参数化控制，不接生产 store。
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
		<Stack gap={4}>
			<Group justify="space-between" wrap="nowrap">
				<Text size="xs" c="dimmed">
					{label}
				</Text>
				<Text size="xs" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
					{display ?? value}
				</Text>
			</Group>
			<Slider
				value={value}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				onChange={onChange}
			/>
		</Stack>
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
		<Group justify="space-between" wrap="nowrap" py={4}>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
		</Group>
	);
}

const DIM_LABELS: Array<{ key: keyof EmotionValues; name: string; color: string }> = [
	{ key: "trust", name: "信任", color: "green" },
	{ key: "anxiety", name: "焦虑", color: "violet" },
	{ key: "irritation", name: "烦躁", color: "orange" },
	{ key: "cooperation", name: "配合", color: "blue" },
];

export default function FaceLabPage() {
	const [gender, setGender] = useState<Gender>("female");
	const [ageGroup, setAgeGroup] = useState<AgeGroup>("young");
	const [label, setLabel] = useState<Emotion4DLabel>("neutral");
	const [values, setValues] = useState<EmotionValues>({ ...PRESETS.neutral });
	const [duration, setDuration] = useState(600);
	const [easing, setEasing] = useState<EasingName>("easeOut");
	const [autoCycle, setAutoCycle] = useState(false);
	const [blink, setBlink] = useState(true);
	const [blinkInterval, setBlinkInterval] = useState(4500);
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
	const appearance = useMemo(() => appearanceFor(gender, ageGroup), [gender, ageGroup]);

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
			<SelectTrigger size="sm">
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
			<SelectTrigger size="sm">
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
		<Box mih="100vh" p="md">
			<Container size="xl">
				<Stack gap="lg">
					<Box>
						<Title order={1} size="xl">
							面部系统调整控制台
						</Title>
						<Text size="sm" c="dimmed" mt={4}>
							临时路由 /face-demo — 实验性过渡动画与参数化控制，不接生产 store
						</Text>
					</Box>

					<Grid>
						{/* ── 预览 ── */}
						<Grid.Col span={{ base: 12, lg: 5 }}>
							<Card>
								<CardContent style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 24 }}>
									<PremiumFaceArtwork
										cfg={display.cfg}
										extras={display.extras}
										appearance={appearance}
										size={220}
										blink={blink}
										blinkInterval={blinkInterval}
									/>
									<Group gap="xs">
										<Badge variant="secondary">{EMOTION_4D_LABELS[label]}</Badge>
										<Text size="10px" c="dimmed" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
											{label} · {duration}ms · {easing}
										</Text>
									</Group>
									<Stack gap={4} w="100%">
										{DIM_LABELS.map((d) => (
											<Group key={d.key} gap="xs" wrap="nowrap">
												<Text size="10px" c="dimmed" w={24}>
													{d.name}
												</Text>
												<Progress
													value={Math.round(values[d.key] * 100)}
													color={d.color}
													size="xs"
													radius="xl"
													style={{ flex: 1 }}
												/>
											</Group>
										))}
									</Stack>
								</CardContent>
							</Card>
						</Grid.Col>

						<Grid.Col span={{ base: 12, lg: 7 }}>
							<Stack gap="lg">
								<Card>
									<CardHeader style={{ paddingBottom: 8 }}>
										<CardTitle>外观（男女老少）</CardTitle>
									</CardHeader>
									<CardContent style={{ display: "flex", flexDirection: "column", gap: 16 }}>
										<Group gap="sm" align="flex-end">
											<Box style={{ flex: 1 }}>
												<Label>性别</Label>
												<Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
													<SelectTrigger size="sm">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="female">女</SelectItem>
														<SelectItem value="male">男</SelectItem>
													</SelectContent>
												</Select>
											</Box>
											<Box style={{ flex: 1 }}>
												<Label>年龄段</Label>
												<Select value={ageGroup} onValueChange={(v) => setAgeGroup(v as AgeGroup)}>
													<SelectTrigger size="sm">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="child">儿童（≤12）</SelectItem>
														<SelectItem value="young">青年（13-25）</SelectItem>
														<SelectItem value="middle">中年（26-59）</SelectItem>
														<SelectItem value="elderly">老年（≥60）</SelectItem>
													</SelectContent>
												</Select>
											</Box>
										</Group>
										<Text size="10px" c="dimmed">
											外观与情绪正交：6 基础外观 × 9 情绪叠加，零笛卡尔积。切换外观后可用上方情绪控件叠加验证。
										</Text>
									</CardContent>
								</Card>

								{/* ── 情绪标签 + 4D ── */}
								<Card>
									<CardHeader style={{ paddingBottom: 8 }}>
										<CardTitle>情绪状态</CardTitle>
									</CardHeader>
									<CardContent style={{ display: "flex", flexDirection: "column", gap: 16 }}>
										<Group gap={6} wrap="wrap">
											{LABELS.map((l) => (
												<Button
													key={l}
													variant={l === label ? "default" : "outline"}
													size="xs"
													radius="xl"
													onClick={() => pickLabel(l)}
												>
													{EMOTION_4D_LABELS[l]}
												</Button>
											))}
										</Group>
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
									<CardHeader style={{ paddingBottom: 8 }}>
										<CardTitle>过渡动画实验</CardTitle>
									</CardHeader>
									<CardContent style={{ display: "flex", flexDirection: "column", gap: 16 }}>
										<RangeRow
											label="过渡时长"
											value={duration}
											min={0}
											max={1500}
											step={50}
											display={`${duration}ms`}
											onChange={setDuration}
										/>
										<Box>
											<Label>缓动曲线</Label>
											<Select value={easing} onValueChange={(v) => setEasing(v as EasingName)}>
												<SelectTrigger size="sm">
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
										</Box>
										<ToggleRow
											label="自动轮播 9 态（4s/态）"
											checked={autoCycle}
											onChange={setAutoCycle}
										/>
										<ToggleRow label="眨眼（CSS 动画）" checked={blink} onChange={setBlink} />
										<RangeRow
											label="眨眼周期"
											value={blinkInterval}
											min={2000}
											max={8000}
											step={250}
											disabled={!blink}
											display={`${blinkInterval}ms`}
											onChange={setBlinkInterval}
										/>
									</CardContent>
								</Card>

								{/* ── 高级参数 ── */}
								<Card>
									<CardHeader style={{ paddingBottom: 8 }}>
										<CardTitle>
											<Group justify="space-between" wrap="nowrap">
												<Text size="sm" fw={600}>
													高级参数（手动覆盖）
												</Text>
												<Switch checked={manual} onCheckedChange={toggleManual} />
											</Group>
										</CardTitle>
									</CardHeader>
									<CardContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
										<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
										</SimpleGrid>
										<Group gap="md" align="flex-end">
											<Box style={{ flex: 1 }}>
												<Text size="xs" c="dimmed" mb={4}>
													嘴型
												</Text>
												<Box style={{ pointerEvents: manual ? undefined : "none", opacity: manual ? undefined : 0.4 }}>
													{mouthSelect}
												</Box>
											</Box>
											<Box style={{ flex: 1 }}>
												<Text size="xs" c="dimmed" mb={4}>
													虹膜朝向
												</Text>
												<Box style={{ pointerEvents: manual ? undefined : "none", opacity: manual ? undefined : 0.4 }}>
													{irisSelect}
												</Box>
											</Box>
										</Group>
										<SimpleGrid cols={2} spacing="sm">
											<ToggleRow label="颊红" checked={targetCfg.blush} disabled={!manual} onChange={(v) => setOverride("blush", v)} />
											<ToggleRow label="泪痕" checked={targetCfg.tears} disabled={!manual} onChange={(v) => setOverride("tears", v)} />
											<ToggleRow label="汗滴" checked={targetExtras.sweat} disabled={!manual} onChange={(v) => setOverride("sweat", v)} />
											<ToggleRow label="皱眉纹" checked={targetExtras.furrow} disabled={!manual} onChange={(v) => setOverride("furrow", v)} />
										</SimpleGrid>
									</CardContent>
								</Card>
							</Stack>
						</Grid.Col>
					</Grid>

					{/* ── 静态参考网格：8 外观组合 ── */}
					<Card>
						<CardHeader style={{ paddingBottom: 8 }}>
							<CardTitle>8 外观组合参考（中性情绪，四阶段×性别）</CardTitle>
						</CardHeader>
						<CardContent>
							<SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
								{(
									[
										["female", "child", "女 · 儿童"],
										["female", "young", "女 · 青年"],
										["female", "middle", "女 · 中年"],
										["female", "elderly", "女 · 老年"],
										["male", "child", "男 · 儿童"],
										["male", "young", "男 · 青年"],
										["male", "middle", "男 · 中年"],
										["male", "elderly", "男 · 老年"],
									] as Array<[Gender, AgeGroup, string]>
								).map(([g, a, name]) => (
									<Stack key={name} align="center" gap={4}>
										<PremiumFaceArtwork
											cfg={faceConfigFrom4D("neutral", PRESETS.neutral)}
											extras={premiumExtrasFrom4D("neutral", PRESETS.neutral)}
											appearance={appearanceFor(g, a)}
											size={96}
										/>
										<Text size="10px" c="dimmed">
											{name}
										</Text>
									</Stack>
								))}
							</SimpleGrid>
						</CardContent>
					</Card>
				</Stack>
			</Container>
		</Box>
	);
}
