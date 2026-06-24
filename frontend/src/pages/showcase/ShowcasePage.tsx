import "@fontsource-variable/geist";
import { useEffect } from "react";
import { PRODUCT_NAME } from "./data";
import EngineeringBand from "./sections/EngineeringBand";
import FinalCta from "./sections/FinalCta";
import FutureOutlook from "./sections/FutureOutlook";
import Hero from "./sections/Hero";
import Highlights from "./sections/Highlights";
import Overview from "./sections/Overview";
import TechStack from "./sections/TechStack";
import TopBar from "./sections/TopBar";

export default function ShowcasePage() {
	useEffect(() => {
		const prev = document.title;
		document.title = `${PRODUCT_NAME} · 产品介绍`;
		return () => {
			document.title = prev;
		};
	}, []);

	return (
		<div className="relative min-h-screen bg-background text-foreground selection:bg-primary/20">
			<div className="pointer-events-none fixed inset-0 -z-30 overflow-hidden">
				<div className="absolute left-1/2 top-0 h-[22rem] w-[22rem] -translate-x-1/2 rounded-full bg-primary/[0.04] blur-[160px]" />
				<div className="absolute bottom-0 right-0 h-[18rem] w-[18rem] rounded-full bg-blue-500/[0.04] blur-[140px]" />
			</div>

			<TopBar />
			<main className="relative z-10">
				<Hero />
				<Overview />
				<Highlights />
				<EngineeringBand />
				<TechStack />
				<FutureOutlook />
				<FinalCta />
			</main>
		</div>
	);
}
