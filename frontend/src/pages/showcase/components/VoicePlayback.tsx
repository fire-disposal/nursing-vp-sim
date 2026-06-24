import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TTS_DEMO_ITEMS } from "../data";

export default function VoicePlayback() {
	const [playingId, setPlayingId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const handlePlay = (id: string, fileName: string) => {
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current = null;
		}

		if (playingId === id) {
			setPlayingId(null);
			return;
		}

		const audio = new Audio(`/audio/${fileName}`);
		audioRef.current = audio;
		setPlayingId(id);

		audio.onended = () => {
			setPlayingId(null);
			audioRef.current = null;
		};

		audio.onerror = () => {
			setPlayingId(null);
			audioRef.current = null;
		};

		audio.play().catch(() => {
			setPlayingId(null);
			audioRef.current = null;
		});
	};

	return (
		<div className="group relative flex min-h-[460px] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)]">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,70,239,0.08),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(13,148,136,0.08),transparent_34%)]" />

			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
						语音合成演示
					</div>
					<div className="mt-1 text-lg font-bold text-foreground">
						豆包 TTS · 情绪联动音色
					</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					SeedTTS 2.0
				</div>
			</div>

			<div className="relative z-10 mt-5 space-y-3">
				{TTS_DEMO_ITEMS.map((item) => {
					const isPlaying = playingId === item.id;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => handlePlay(item.id, item.fileName)}
							className={cn(
								"flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300",
								isPlaying
									? "border-primary/40 bg-background shadow-lg shadow-primary/10"
									: "border-border/60 bg-background/70 hover:-translate-y-0.5 hover:border-primary/20",
							)}
						>
							<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-all">
								{isPlaying ? (
									<Pause size={18} strokeWidth={2} />
								) : (
									<Play size={18} strokeWidth={2} className="ml-0.5" />
								)}
							</div>

							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<div className={cn("size-1.5 rounded-full", item.emotionClass)} />
									<span className="text-xs font-semibold text-muted-foreground">
										{item.label}
									</span>
								</div>
								<div
									className={cn(
										"mt-1 text-sm leading-relaxed transition-colors",
										isPlaying ? "text-primary" : "text-foreground/80",
									)}
								>
									"{item.patientText}"
								</div>
							</div>

							{isPlaying && (
								<div className="flex shrink-0 items-center gap-1">
									{[0, 1, 2].map((i) => (
										<div
											key={i}
											className="w-0.5 rounded-full bg-primary animate-[audio-wave_0.6s_ease-in-out_infinite]"
											style={{
												height: `${10 + i * 6}px`,
												animationDelay: `${i * 0.15}s`,
											}}
										/>
									))}
								</div>
							)}
						</button>
					);
				})}
			</div>

			<div className="relative z-10 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-2.5">
				<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
					提供方
				</div>
				<div className="flex gap-2 text-xs text-muted-foreground">
					<span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">火山引擎</span>
				</div>
			</div>
		</div>
	);
}
