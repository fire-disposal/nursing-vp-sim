import { TECH_STACK } from "../data";

export default function TechStack() {
	const items = [...TECH_STACK, ...TECH_STACK];
	return (
		<section className="border-y border-border/60 py-10">
			<div className="group relative flex overflow-hidden">
				<div className="flex shrink-0 animate-[marquee_24s_linear_infinite] gap-12 pr-12 motion-reduce:animate-none">
					{items.map((t, i) => (
						<span
							key={`${t}-${i}`}
							className="whitespace-nowrap text-lg font-medium text-muted-foreground [font-family:'Geist_Variable',sans-serif]"
						>
							{t}
						</span>
					))}
				</div>
			</div>
		</section>
	);
}
