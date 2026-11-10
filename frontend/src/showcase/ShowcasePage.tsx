import { Box } from "@mantine/core";
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
		<Box mih="100vh" pos="relative">
			<a className="skip-link" href="#showcase-main">
				跳到主要内容
			</a>
			<TopBar />
			<Box component="main" id="showcase-main" tabIndex={-1} pos="relative" style={{ zIndex: 10 }}>
				<Hero />
				<Overview />
				<Highlights />
				<EngineeringBand />
				<TechStack />
				<FutureOutlook />
				<FinalCta />
			</Box>
		</Box>
	);
}
