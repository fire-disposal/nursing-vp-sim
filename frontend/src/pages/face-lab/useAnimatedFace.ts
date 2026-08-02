import { useEffect, useRef, useState } from "react";
import type { FaceConfig } from "@/components/training/face/expressionMap";
import type { PremiumExtras } from "@/components/training/face/premiumExtras";
import { EASINGS, interpolateExtras, interpolateFaceConfig, type EasingName } from "./animation";

/**
 * useAnimatedFace — 把目标配置平滑过渡到当前显示配置。
 *
 * - 目标变化时从"当前显示值"开始插值（中断可平滑衔接，不跳变）
 * - duration=0 时直切
 * - 卸载清理 rAF
 */

interface AnimatedFace {
	cfg: FaceConfig;
	extras: PremiumExtras;
}

export function useAnimatedFace(
	targetCfg: FaceConfig,
	targetExtras: PremiumExtras,
	duration: number,
	easing: EasingName,
): AnimatedFace {
	const [display, setDisplay] = useState<AnimatedFace>({ cfg: targetCfg, extras: targetExtras });
	const displayRef = useRef<AnimatedFace>({ cfg: targetCfg, extras: targetExtras });
	const animRef = useRef<number | null>(null);

	useEffect(() => {
		const from = displayRef.current;
		const to = { cfg: targetCfg, extras: targetExtras };
		if (animRef.current != null) {
			cancelAnimationFrame(animRef.current);
		}
		if (duration <= 0) {
			displayRef.current = to;
			setDisplay(to);
			return;
		}
		const start = performance.now();
		const ease = EASINGS[easing];
		const step = (now: number) => {
			const p = Math.min(1, (now - start) / duration);
			const t = ease(p);
			const next: AnimatedFace = {
				cfg: interpolateFaceConfig(from.cfg, to.cfg, t),
				extras: interpolateExtras(from.extras, to.extras, t),
			};
			displayRef.current = next;
			setDisplay(next);
			if (p < 1) {
				animRef.current = requestAnimationFrame(step);
			} else {
				displayRef.current = to;
				setDisplay(to);
				animRef.current = null;
			}
		};
		animRef.current = requestAnimationFrame(step);
		return () => {
			if (animRef.current != null) {
				cancelAnimationFrame(animRef.current);
				animRef.current = null;
			}
		};
	}, [targetCfg, targetExtras, duration, easing]);

	return display;
}
