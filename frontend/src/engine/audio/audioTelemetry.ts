import { accessHeaders } from "@/utils/accessContext";

export interface AudioTelemetrySample {
	session_id: string;
	mode: "workbench" | "phone";
	character_id?: string | null;
	delay_ms?: number | null;
	erle_db?: number | null;
	erl_db?: number | null;
	divergent_filter_fraction?: number | null;
	voice?: boolean | null;
	reference_short?: number;
	reference_dropped?: number;
	non_finite_samples?: number;
	errors?: number;
}

/** 诊断遥测：低频、best-effort，不阻塞通话。 */
export async function reportAudioTelemetry(sample: AudioTelemetrySample): Promise<void> {
	try {
		await fetch("/api/voice-demo/audio-telemetry", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...accessHeaders() },
			body: JSON.stringify(sample),
			keepalive: true,
		});
	} catch {
		/* 遥测失败不影响通话 */
	}
}
