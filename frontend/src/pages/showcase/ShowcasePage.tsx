import "@fontsource-variable/geist";
import { useEffect } from "react";
import { PRODUCT_NAME } from "./data";
import EngineeringBand from "./sections/EngineeringBand";
import FinalCta from "./sections/FinalCta";
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
		<div className="min-h-screen bg-background text-foreground">
			<TopBar />
			<main>
				<Hero />
				<Overview />
				<Highlights />
				<EngineeringBand />
				<TechStack />
				<FinalCta />
			</main>
		</div>
	);
}
