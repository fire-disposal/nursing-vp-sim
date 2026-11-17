import { Textarea } from "@mantine/core";
import {
	IconAlertCircle,
	IconKeyboard,
	IconLoader2,
	IconMicrophone,
	IconPlayerStop,
	IconSend,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useToast } from "@/components/Toast";
import type { MessageBus } from "@/engine/types";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";
import useAuthStore from "@/stores/authStore";
import "./ConversationComposer.css";

type ComposerMode = "text" | "voice";

interface ConversationComposerProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
	bus?: MessageBus | null;
	onBargeIn?: () => void;
}

function VoiceMeter() {
	return (
		<span className="vp-composer__meter" aria-hidden="true">
			<span />
			<span />
			<span />
			<span />
			<span />
		</span>
	);
}

export function ConversationComposer({
	onSend,
	disabled,
	loading,
	trainingEnded,
	bus,
	onBargeIn,
}: ConversationComposerProps) {
	const { recordId } = useParams<{ recordId: string }>();
	const token = useAuthStore((s) => s.token);
	const [mode, setMode] = useState<ComposerMode>("text");
	const [text, setText] = useState("");
	const [patientSpeaking, setPatientSpeaking] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const toast = useToast();

	useEffect(() => {
		if (!bus) {
			setPatientSpeaking(false);
			return;
		}
		const offStart = bus.on("tts:start", () => setPatientSpeaking(true));
		const offEnd = bus.on("tts:end", () => setPatientSpeaking(false));
		return () => {
			offStart();
			offEnd();
		};
	}, [bus]);

	const voice = useVoiceDialogue({
		onSend,
		patientReplying: !!loading,
		patientSpeaking,
		autoRearm: false,
		silenceMs: 800,
		continuous: true,
		onBargeIn,
		recordId: recordId ? Number(recordId) : null,
		token,
	});

	const duplex = voice.supported && !voice.continuousFailed;
	const voiceActive = duplex ? voice.continuousArmed : voice.phase === "listening";
	const capturing = voice.transcript.trim().length > 0;
	const unsupported = !voice.supported;
	const unsupportedHint = "当前浏览器不支持语音输入，请继续使用文字对话";

	const turnText = voice.interrupted
		? "已打断患者"
		: patientSpeaking
			? "患者正在播报"
			: loading
				? "患者正在思考"
				: voiceActive
					? "正在聆听"
					: "轮到你了";
	const turnTone = voice.interrupted ? "interrupted" : patientSpeaking || loading ? "patient" : "student";

	const selectMode = useCallback(
		(next: ComposerMode) => {
			if (next === mode) return;
			if (next === "text") voice.reset();
			setMode(next);
			if (next === "text") requestAnimationFrame(() => inputRef.current?.focus());
		},
		[mode, voice],
	);

	const handleSend = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled || loading) return;
		onSend(trimmed);
		setText("");
		inputRef.current?.focus();
	}, [text, onSend, disabled, loading]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key !== "Enter" || e.shiftKey) return;
			if (e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229) return;
			e.preventDefault();
			handleSend();
		},
		[handleSend],
	);

	const handleMicClick = useCallback(() => {
		if (unsupported) {
			toast.warning(unsupportedHint);
			return;
		}
		if (!duplex) return;
		if (voice.continuousArmed) voice.stop();
		else voice.start();
	}, [unsupported, unsupportedHint, duplex, voice, toast]);

	const handleMicDown = useCallback(
		(e: React.PointerEvent) => {
			if (duplex) return;
			e.preventDefault();
			if (unsupported) {
				toast.warning(unsupportedHint);
				return;
			}
			voice.pressStart();
		},
		[duplex, unsupported, unsupportedHint, voice, toast],
	);

	const handleMicUp = useCallback(() => {
		if (!duplex) voice.pressEnd();
	}, [duplex, voice]);

	const handleMicKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (duplex || (e.key !== " " && e.key !== "Enter") || e.repeat) return;
			e.preventDefault();
			voice.pressStart();
		},
		[duplex, voice],
	);

	const handleMicKeyUp = useCallback(
		(e: React.KeyboardEvent) => {
			if (duplex || (e.key !== " " && e.key !== "Enter")) return;
			e.preventDefault();
			voice.pressEnd();
		},
		[duplex, voice],
	);

	const micDisabled = trainingEnded || (!duplex && (disabled || loading));
	const voiceTitle = trainingEnded
		? "训练已结束"
		: unsupported
			? "当前浏览器无法语音输入"
			: duplex
				? voice.continuousArmed
					? voice.interrupted
						? "已打断，正在听你说"
						: capturing
							? "正在识别你的发言"
							: "持续聆听中"
					: "开始持续对谈"
				: voice.phase === "listening"
					? "松开自动发送"
					: "按住说话";
	const voiceDescription = unsupported
		? unsupportedHint
		: duplex
			? voice.continuousArmed
				? voice.basicVoiceMode
					? "直接说话，停顿后自动发送。基础模式仍可使用语音识别。"
					: "直接说话，停顿自动发送。患者播报时持续开口可打断。"
				: "开启后不必按住说话，随时可以停止聆听。"
			: "按住麦克风说话，说完松开即可发送。";
	const notice = voice.notice ?? (voice.basicVoiceMode && mode === "voice" ? "当前设备已使用基础语音模式" : null);

	return (
		<section className="vp-composer stu-composer" aria-label="患者对话输入">
			<div className="vp-composer__frame" data-active={voiceActive}>
				<div className="vp-composer__toolbar">
					<fieldset className="vp-composer__modes" aria-label="输入方式">
						<button
							type="button"
							className="vp-composer__mode"
							aria-pressed={mode === "text"}
							onClick={() => selectMode("text")}
						>
							<IconKeyboard size={17} aria-hidden="true" />
							文字
						</button>
						<button
							type="button"
							className="vp-composer__mode"
							aria-pressed={mode === "voice"}
							disabled={trainingEnded}
							onClick={() => selectMode("voice")}
						>
							<IconMicrophone size={17} aria-hidden="true" />
							语音
						</button>
					</fieldset>
					<div className="vp-composer__turn" data-tone={turnTone} role="status" aria-live="polite">
						<span className="vp-composer__turn-dot" aria-hidden="true" />
						<span className="vp-composer__turn-label">{turnText}</span>
					</div>
				</div>

				<div className="vp-composer__body">
					{mode === "text" ? (
						<div className="vp-composer__text-entry">
							<Textarea
								maxLength={2000}
								ref={inputRef}
								value={text}
								onChange={(e) => setText(e.target.value)}
								onKeyDown={handleKeyDown}
								onCompositionStart={() => { composingRef.current = true; }}
								onCompositionEnd={() => { composingRef.current = false; }}
								placeholder={trainingEnded ? "训练已结束" : loading ? "患者正在回复中…" : "输入你想问患者的话…"}
								disabled={disabled || loading || trainingEnded}
								rows={2}
								classNames={{ input: "vp-composer__textarea" }}
								aria-label="对患者说的话"
								aria-describedby="vp-composer-input-hint"
							/>
							<div className="vp-composer__text-footer">
								<span className="vp-composer__shortcut" id="vp-composer-input-hint">
									Enter 发送，Shift + Enter 换行
								</span>
								{text.length >= 1600 && <span className="vp-composer__count">{text.length}/2000</span>}
								<button
									type="button"
									className="vp-composer__send"
									disabled={!text.trim() || disabled || loading || trainingEnded}
									onClick={handleSend}
									aria-label="发送消息"
								>
									{loading ? <IconLoader2 size={18} className="animate-spin" /> : <IconSend size={18} />}
									{loading ? "等待" : "发送"}
								</button>
							</div>
						</div>
					) : (
						<div className="vp-composer__voice">
							<button
								type="button"
								className="vp-composer__mic"
								data-stop={voiceActive}
								disabled={micDisabled}
								aria-disabled={unsupported || micDisabled}
								aria-label={voiceActive ? (duplex ? "停止持续对谈" : "松开并发送语音") : duplex ? "开始持续对谈" : "按住说话"}
								aria-pressed={duplex ? voice.continuousArmed : undefined}
								onClick={handleMicClick}
								onPointerDown={handleMicDown}
								onPointerUp={handleMicUp}
								onPointerLeave={handleMicUp}
								onPointerCancel={handleMicUp}
								onKeyDown={handleMicKeyDown}
								onKeyUp={handleMicKeyUp}
							>
								{voiceActive ? <IconPlayerStop size={24} /> : <IconMicrophone size={25} />}
							</button>
							<div className="vp-composer__voice-copy">
								<h3 className="vp-composer__voice-title">{voiceTitle}</h3>
								<p className="vp-composer__voice-description">{voiceDescription}</p>
								{capturing && (
									<section className="vp-composer__transcript" aria-label="实时转写">
										{voice.transcript}
									</section>
								)}
							</div>
							{voiceActive ? <VoiceMeter /> : loading ? <IconLoader2 size={22} className="animate-spin" aria-label="患者正在回复" /> : null}
						</div>
					)}
				</div>

				{mode === "voice" && notice && (
					<div className="vp-composer__notice" data-error={!voice.basicVoiceMode} role={voice.basicVoiceMode ? "status" : "alert"}>
						<IconAlertCircle size={17} aria-hidden="true" />
						<span>{notice}</span>
					</div>
				)}
			</div>
		</section>
	);
}
