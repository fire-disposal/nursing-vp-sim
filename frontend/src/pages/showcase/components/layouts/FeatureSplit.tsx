import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Reveal from "../Reveal";

interface FeatureSplitProps {
	icon: LucideIcon;
	title: string;
	body: string;
	points: string[];
	reverse?: boolean;
	visual: ReactNode;
}

export default function FeatureSplit({
	icon: Icon,
	title,
	body,
	points,
	reverse,
	visual,
}: FeatureSplitProps) {
	return (
		<div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
			<Reveal className={reverse ? "md:order-2" : ""}>
				<div className="flex flex-col gap-4">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={24} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-2xl font-bold tracking-tight [font-family:'Geist_Variable',sans-serif]">
						{title}
					</h3>
					<p className="max-w-[65ch] leading-relaxed text-muted-foreground">
						{body}
					</p>
					<ul className="flex flex-col gap-2">
						{points.map((p) => (
							<li key={p} className="flex gap-2 text-sm text-foreground/80">
								<span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
								<span>{p}</span>
							</li>
						))}
					</ul>
				</div>
			</Reveal>
			<Reveal delay={120} className={reverse ? "md:order-1" : ""}>
				{visual}
			</Reveal>
		</div>
	);
}
