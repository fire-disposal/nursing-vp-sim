import "@fontsource-variable/geist";
import { useEffect } from "react";
import { Box } from "@mantine/core";
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
			<Box
				pos="fixed"
				inset={0}
				style={{ pointerEvents: "none", zIndex: -30, overflow: "hidden" }}
			>
				<Box
					style={{
						position: "absolute",
						left: "50%",
						top: 0,
						width: "22rem",
						height: "22rem",
						transform: "translateX(-50%)",
						borderRadius: "50%",
						background: "var(--mantine-primary-color-6)",
						opacity: 0.04,
						filter: "blur(160px)",
					}}
				/>
				<Box
					style={{
						position: "absolute",
						bottom: 0,
						right: 0,
						width: "18rem",
						height: "18rem",
						borderRadius: "50%",
						background: "var(--mantine-color-blue-5)",
						opacity: 0.04,
						filter: "blur(140px)",
					}}
				/>
			</Box>

			<TopBar />
			<Box component="main" pos="relative" style={{ zIndex: 10 }}>
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
