import { TECH_STACK } from "../data";

export default function TechStack() {
	return (
		<section className="border-y border-border/60 py-10">
				<div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
				<div className="flex w-max animate-[marquee-third_42s_linear_infinite] motion-reduce:animate-none">
					{[0, 1, 2].map((groupIndex) => (
						<div key={groupIndex} className="flex shrink-0 gap-10 pr-10 md:gap-12 md:pr-12">
							{TECH_STACK.map((t) => (
								<span
									key={`${groupIndex}-${t}`}
									className="whitespace-nowrap text-sm font-medium text-muted-foreground md:text-base [font-family:'Geist_Variable',sans-serif]"
								>
									{t}
								</span>
							))}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
