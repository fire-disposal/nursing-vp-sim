import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Reveal from "../Reveal";

interface FeatureFullProps {
	icon: LucideIcon;
	title: string;
	body: string;
	points: string[];
	visual?: ReactNode;
}

export default function FeatureFull({
	icon: Icon,
	title,
	body,
	points,
	visual,
}: FeatureFullProps) {
	return (
		<Reveal>
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={24} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-2xl font-bold tracking-tight md:text-3xl [font-family:'Geist_Variable',sans-serif]">
						{title}
					</h3>
					<p className="max-w-[65ch] leading-relaxed text-muted-foreground">
						{body}
					</p>
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{points.map((p) => (
						<div
							key={p}
							className="rounded-2xl border border-border bg-card p-4 text-sm text-foreground/80"
						>
							{p}
						</div>
					))}
				</div>
				{visual}
			</div>
		</Reveal>
	);
}
