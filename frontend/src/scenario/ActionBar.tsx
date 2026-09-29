import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type {
	ScenarioActionInput,
	ScenarioAffordance,
	ScenarioTarget,
	ScenarioView,
} from "@/api/scenario";
import AffordanceForm from "./AffordanceForm";
import { targetText, timeCost } from "./stream";

export type ScenarioIntent = { kind: "speech" | "action"; target: ScenarioTarget | null };
export interface ActionBarProps {
	view: ScenarioView;
	busy: boolean;
	freeText: string;
	onFreeTextChange: (text: string) => void;
	onSubmit: (action: ScenarioActionInput) => void;
	errorMessage?: string | null;
	openAffordance?: ScenarioAffordance | null;
	onCloseForm: () => void;
	onOpenForm: (id: string) => void;
	intent: ScenarioIntent;
	onIntentChange: (intent: ScenarioIntent) => void;
	onHint: () => void;
}
const MAX_INPUT = 2000;
const targetKey = (target: ScenarioTarget) => `${target.kind}:${target.id}`;

/** 一个可选对象：`available` 为假 = 声明过但此刻不可达（可选出来，但发不出去）。 */
interface TargetChoice {
	target: ScenarioTarget;
	label: string;
	available: boolean;
}

/**
 * 输入区：**说话 / 行动 + 对象 + 一句话**。
 *
 * 语义约束（`docs/scenario.md` §7.4）：
 * - 「说话」与「行动」都有文字标签；行动表示**尝试**，不在乐观气泡上写成"已完成"。
 * - 对象**始终可见**；切换模式或对象不丢草稿；对象离场时要求**重新选择**，绝不静默换人。
 * - 多床／多设备时第一次不替学生猜目标；场景里只有一个可接触对象时才默认选中它。
 * - 中文输入法合成期间 Enter 不能发送；桌面 Enter 发送、Shift+Enter 换行；手机保留发送按钮。
 * - 求提示是**只读**教学交互：填入草稿供阅读修改，不直接执行任何处置。
 */
export default function ActionBar({ view, busy, freeText, onFreeTextChange, onSubmit,
	errorMessage, openAffordance = null, onCloseForm, onOpenForm, intent, onIntentChange, onHint }: ActionBarProps) {
	const areaRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const autoPickedRef = useRef("");
	const [formsOpen, setFormsOpen] = useState(false);
	const actors = view.actors ?? [];
	const devices = view.devices ?? [];
	const affordances = view.affordances ?? [];

	/**
	 * 可选对象：
	 * - 已展开的声明动作**绑定对象**时，只能在这些对象里选（`affordance.targets`）——
	 *   绑定目标即使此刻不可达也照样可选：世界会诚实回答"他不在"，而不是让按钮消失；
	 * - 其余情况 = 可接触的在场者，行动时再加设备与场景。
	 * 不可接触的人**不在**清单里：看得见（在场者条），但选不成目标。
	 */
	const boundTargets = openAffordance?.targets ?? [];
	const choices: TargetChoice[] = (
		boundTargets.length > 0
			? boundTargets.map((target) => ({ target, available: true }))
			: [
					...actors
						.filter((actor) => actor.contactable)
						.map((actor) => ({
							target: { kind: "actor" as const, id: actor.id },
							available: true,
						})),
					...(intent.kind === "action"
						? [
								...devices.map((device) => ({
									target: { kind: "device" as const, id: device.id },
									available: true,
								})),
								{ target: { kind: "scene" as const, id: "scene" }, available: true },
							]
						: []),
				]
	).map((choice) => ({ ...choice, label: targetText(choice.target, view) }));
	const selected = intent.target
		? choices.find((item) => targetKey(item.target) === targetKey(intent.target!))
		: null;
	const targetInvalid = intent.target !== null && selected?.available !== true;

	/*
	 * 对象是不是**发送必需**（冻结口径，2026-09-29）：
	 * - `action`：动作自己声明了 `targets` 就由平台绑定/澄清，声明为空更不要求对象——
	 *   前端**不得**因为"没选对象"拦住一次尝试（否则学生连试都试不了）。
	 * - `speech`：只有场景里**存在可搭话的人**时才要求收信人；一个人都搭不上话时，
	 *   给出人话说明（"此刻没有人可以对话"），而不是让发送键无声地死掉。
	 * 任何禁用都必须能说出为什么（见下面的 note）。
	 */
	const contactableActors = actors.filter((actor) => actor.contactable);
	const speechWithoutRecipient = intent.kind === "speech" && contactableActors.length === 0;
	const needsRecipient = intent.kind === "speech" && contactableActors.length > 0;
	const targetReady = speechWithoutRecipient
		? false
		: needsRecipient
			? selected?.available === true
			: !targetInvalid;
	const canSend = !busy && targetReady && freeText.trim().length > 0;
	const forms = affordances.filter((item) => item.type === "document" || item.select !== "none");

	// 场景里只有一个可接触对象时不逼学生再点一次；两个以上一律等他自己选（不猜多床目标）。
	const usableTargets = choices.filter((item) => item.available);
	const autoKey = `${intent.kind}|${usableTargets.map((item) => targetKey(item.target)).join(",")}`;
	const autoTarget = usableTargets.length === 1 ? usableTargets[0].target : null;
	useEffect(() => {
		if (autoTarget === null || intent.target !== null || autoPickedRef.current === autoKey) return;
		autoPickedRef.current = autoKey;
		onIntentChange({ ...intent, target: autoTarget });
	}, [autoKey, autoTarget, intent, onIntentChange]);

	useEffect(() => {
		const area = areaRef.current;
		if (!area) return;
		area.style.height = "auto";
		area.style.height = `${area.scrollHeight}px`;
	}, [freeText]);
	const submit = () => {
		if (!canSend || composingRef.current) return;
		onSubmit({ kind: intent.kind, target: intent.target, text: freeText.trim(), selection: [] });
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229 || window.matchMedia("(pointer: coarse)").matches) return;
		event.preventDefault();
		submit();
	};
	const targetNotice = targetInvalid
		? `${targetText(intent.target, view)} 已不可达，请重新选择对象。`
		: speechWithoutRecipient
			? "此刻没有人可以对话。"
			: needsRecipient && selected === null
				? "先选一个收信人，再发送。"
				: null;

	return <section className="sc-actions" aria-label="表达与行动">
		{openAffordance && <AffordanceForm key={openAffordance.id} affordance={openAffordance} busy={busy} target={intent.target} targetLabel={targetText(intent.target, view)} onSubmit={(action) => onSubmit(action)} onCancel={onCloseForm} />}
		{errorMessage && <div className="sc-error" role="alert">{errorMessage}</div>}
		<div className="sc-composer" data-busy={busy || undefined}>
			<fieldset className="sc-intents">
				<legend className="sc-visually-hidden">表达方式与对象</legend>
				{(["speech", "action"] as const).map((kind) => <button key={kind} type="button" className="sc-intent" aria-pressed={intent.kind === kind} onClick={() => onIntentChange({ kind, target: kind === "speech" && intent.target?.kind !== "actor" ? null : intent.target })}>{kind === "speech" ? "说话" : "行动"}</button>)}
				<label className="sc-target">对象：<select aria-label="当前对象（说话或行动的对象）" value={intent.target ? targetKey(intent.target) : ""} onChange={(event) => onIntentChange({ ...intent, target: choices.find((item) => targetKey(item.target) === event.currentTarget.value)?.target ?? null })}>
					{/* 占位只在真的没有对象可选时出现；否则学生该看见的是当前对象或"请选择" */}
					<option value="">{intent.kind === "speech" ? "请选择收信人" : "不指定（平台按动作判定）"}</option>
					{targetInvalid && <option value={targetKey(intent.target!)}>{targetText(intent.target, view)}（已不可达）</option>}
					{choices.filter((item) => item.available).map((item) => <option key={targetKey(item.target)} value={targetKey(item.target)}>{item.label}</option>)}
				</select></label>
			</fieldset>
			<div className="sc-composer-input">
				<textarea ref={areaRef} className="sc-textarea" rows={1} maxLength={MAX_INPUT} aria-label={intent.kind === "speech" ? "你要说的话" : "要尝试的行动"} aria-describedby="sc-input-help" placeholder={intent.kind === "speech" ? "输入你要说的话……" : "描述要尝试的行动……"} value={freeText} onChange={(event) => onFreeTextChange(event.currentTarget.value)} onKeyDown={onKeyDown} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} />
				<button type="button" className="sc-btn sc-send" disabled={!canSend} onClick={submit}>发送</button>
			</div>
		</div>
		{targetNotice !== null && <div className="sc-composer-note" role="status">{targetNotice}</div>}
		<div className="sc-input-tools">
			<span id="sc-input-help" className="sc-input-help">Enter 发送 · Shift+Enter 换行</span>
			<button type="button" className="sc-ghost-btn" disabled={busy} onClick={onHint}>给我一点提示</button>
			{forms.length > 0 && <button type="button" className="sc-ghost-btn" aria-expanded={formsOpen} onClick={() => setFormsOpen((open) => !open)}>记录／选择</button>}
		</div>
		{/* 声明动作仍是显式入口；这里列出可展开表单，点开后才进入表单本身。 */}
		{formsOpen && <div className="sc-options">{forms.map((form) => <button key={form.id} type="button" className="sc-option" disabled={busy} onClick={() => { onOpenForm(form.id); setFormsOpen(false); }}>{form.label}{timeCost(form) > 0 && <span className="sc-time-cost">耗时</span>}</button>)}</div>}
	</section>;
}
