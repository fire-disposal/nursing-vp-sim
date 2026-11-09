import { useEffect, useMemo, useRef, useState } from "react";
import type { ClinicalEvidence, ClinicalJudgmentState } from "@/api/clinical-reasoning";
import { newlyObservedEvidence } from "./evidence-model";

/** 「刚拿到」的高亮保留时长：足够看清是哪一条，又不至于挂在屏幕上打扰问诊。 */
const FLASH_MS = 2400;

export interface EvidenceNexus {
	/** 最近一轮新到的证据 id（按服务端顺序）；空数组 = 无新证据。 */
	freshIds: string[];
	/** 这些证据是第几轮拿到的（同一轮共享同一个序号）。 */
	wave: number;
}

export interface EvidenceLink {
	/** 新证据里**第一条带来源消息**的 message_id：对话列的联结高亮指向它。 */
	messageId: number | null;
	/** 该证据的 id —— 联结线与对话高亮必须指向"同一条证据"，否则会指错。 */
	findingId: string | null;
}

/**
 * 证据工作台的**记忆点**：新证据「浮现」。
 *
 * 观察/行动成功后服务端返回新状态，这里比对"上次已知的 finding 集合"，把这一轮**新增**的
 * 证据标记出来 —— 证据卡自己播放一次性入场（细线扫过 + 左缘短促亮起），同时在对话列里，
 * 产出这条证据的那句患者回答被同一时长地强调一次（「联结」）。
 *
 * 为什么由状态驱动而不是定时器驱动：浮现必须与**真实状态变化**一一对应，否则就是装饰。
 * 首次加载不算（一进页面全体闪烁 = 没有信号）；来源消息不在当前对话里时不做联结
 * （宁可没有，也不要指错一句话）。
 */
export function useEvidenceNexus(
	state: ClinicalJudgmentState | null,
	availableMessageIds: ReadonlySet<number>,
): { nexus: EvidenceNexus; link: EvidenceLink } {
	const knownRef = useRef<Set<string> | null>(null);
	const waveRef = useRef(0);
	const [fresh, setFresh] = useState<{ items: ClinicalEvidence[]; wave: number }>({
		items: [],
		wave: 0,
	});

	const evidence = state?.evidence;
	const evidenceKey = evidence ? evidence.map((item) => item.finding_id).join("\u0001") : "";

	useEffect(() => {
		if (!evidence) return;
		const isFirstLoad = knownRef.current === null;
		const added = newlyObservedEvidence(knownRef.current, evidence);
		knownRef.current = new Set(evidence.map((item) => item.finding_id));
		if (isFirstLoad || added.length === 0) return;

		waveRef.current += 1;
		const wave = waveRef.current;
		setFresh({ items: added, wave });
		const timer = window.setTimeout(() => {
			setFresh((prev) => (prev.wave === wave ? { items: [], wave } : prev));
		}, FLASH_MS);
		return () => window.clearTimeout(timer);
	}, [evidence, evidenceKey]);

	const nexus = useMemo<EvidenceNexus>(
		() => ({ freshIds: fresh.items.map((item) => item.finding_id), wave: fresh.wave }),
		[fresh],
	);

	const link = useMemo<EvidenceLink>(() => {
		const source = fresh.items.find(
			(item) => item.message_id !== undefined && availableMessageIds.has(item.message_id),
		);
		return { messageId: source?.message_id ?? null, findingId: source?.finding_id ?? null };
	}, [availableMessageIds, fresh.items]);

	return { nexus, link };
}
