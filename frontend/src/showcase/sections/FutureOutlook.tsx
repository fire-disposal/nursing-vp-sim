import { Monitor, Smartphone } from "lucide-react";
import Reveal from "../components/Reveal";

export default function FutureOutlook() {
	return (
		<section className="mx-auto max-w-5xl px-6 py-20 md:py-24">
			<Reveal>
				<div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-8 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)] md:p-10">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(99,102,241,0.06),transparent_50%),radial-gradient(circle_at_70%_30%,rgba(13,148,136,0.05),transparent_50%)]" />

					<div className="relative z-10 flex flex-col items-center text-center">
						<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">未来展望</div>
						<h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl [font-family:'Geist_Variable',sans-serif]">
							随时随地，触手可及
						</h2>
						<p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted-foreground md:text-base">
							即将推出微信小程序与手机 App 适配，将虚拟患者训练从桌面延伸到移动端，让学生在任何场景下都能随时随地进行护理沟通练习。
						</p>

						<div className="mt-8 flex flex-col gap-6 sm:flex-row sm:gap-12">
							<div className="flex items-center gap-4 rounded-2xl border border-border/50 bg-background/50 px-5 py-4">
								<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
									<Smartphone size={20} strokeWidth={1.5} className="text-emerald-500" />
								</div>
								<div className="text-left">
									<div className="text-sm font-bold text-foreground">微信小程序</div>
									<div className="mt-0.5 text-xs text-muted-foreground">轻量接入，即开即用</div>
								</div>
							</div>
							<div className="flex items-center gap-4 rounded-2xl border border-border/50 bg-background/50 px-5 py-4">
								<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10">
									<Monitor size={20} strokeWidth={1.5} className="text-indigo-500" />
								</div>
								<div className="text-left">
									<div className="text-sm font-bold text-foreground">手机 App</div>
									<div className="mt-0.5 text-xs text-muted-foreground">原生体验，深度集成</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</Reveal>
		</section>
	);
}
