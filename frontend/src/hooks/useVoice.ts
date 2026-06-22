import { useCallback, useRef, useState } from "react";
import { api } from "@/api/axios-instance";

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result as string;
			const comma = result.indexOf(",");
			resolve(comma >= 0 ? result.slice(comma + 1) : result);
		};
		reader.onerror = () => reject(new Error("音频编码失败"));
		reader.readAsDataURL(blob);
	});
}

export interface UseVoiceReturn {
	isListening: boolean;
	isProcessing: boolean;
	partialText: string;
	startListening: () => Promise<string>;
	stopListening: () => void;
	cancelListening: () => void;
}

export default function useVoice(): UseVoiceReturn {
	const [isListening, setIsListening] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [partialText, setPartialText] = useState("");
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const resolveRef = useRef<((text: string) => void) | null>(null);

	const startListening = useCallback((): Promise<string> => {
		return new Promise((resolve, reject) => {
			void (async () => {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

					chunksRef.current = [];
					const mimeType = MediaRecorder.isTypeSupported("audio/webm")
						? "audio/webm"
						: "audio/mp4";

					const recorder = new MediaRecorder(stream, { mimeType });
					resolveRef.current = resolve;

					recorder.ondataavailable = (e) => {
						if (e.data.size > 0) chunksRef.current.push(e.data);
					};

					recorder.onstop = async () => {
						setIsListening(false);
						setIsProcessing(true);
						try {
							const blob = new Blob(chunksRef.current, { type: mimeType });
							const base64 = await blobToBase64(blob);
							const format = mimeType === "audio/webm" ? "webm" : "mp4";
							const res = await api.post("/asr/recognize", {
								audio: base64,
								format,
								sample_rate: 16000,
							});
							const text = (res.data as { text: string; confidence: number }).text;
							setPartialText(text);
							resolve(text);
						} catch (err) {
							reject(err);
						} finally {
							setIsProcessing(false);
							resolveRef.current = null;
						}
					};

					recorder.onerror = () => {
						setIsListening(false);
						resolveRef.current = null;
						reject(new Error("录音失败"));
					};

					recorder.start();
					mediaRecorderRef.current = recorder;
					setIsListening(true);
				} catch (err) {
					reject(err);
				}
			})();
		});
	}, []);

	const stopListening = useCallback(() => {
		const recorder = mediaRecorderRef.current;
		if (!recorder || recorder.state === "inactive") return;
		recorder.stop();
		for (const t of recorder.stream.getTracks()) t.stop();
	}, []);

	const cancelListening = useCallback(() => {
		const recorder = mediaRecorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			for (const t of recorder.stream.getTracks()) t.stop();
		}
		setIsListening(false);
		setPartialText("");
		resolveRef.current?.("");
		resolveRef.current = null;
	}, []);

	return {
		isListening,
		isProcessing,
		partialText,
		startListening,
		stopListening,
		cancelListening,
	};
}
