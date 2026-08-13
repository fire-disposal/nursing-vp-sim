import { Box, SimpleGrid, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { OVERVIEW_STATS, type OverviewStat } from "../data";
import { prefersReducedMotion } from "../gsap";

function Stat({ stat }: { stat: OverviewStat }) {
	const ref = useRef<HTMLDivElement>(null);
	const [n, setN] = useState(() => (prefersReducedMotion() ? stat.value : 0));

	useEffect(() => {
		if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
			setN(stat.value);
			return;
		}
		const el = ref.current;
		if (!el) return;
		let raf = 0;
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				io.disconnect();
				const start = performance.now();
				const dur = 900;
				const tick = (t: number) => {
					const p = Math.min(1, (t - start) / dur);
					setN(Math.round(stat.value * (1 - (1 - p) ** 3)));
					if (p < 1) raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
			}
		}, { threshold: 0.5 });
		io.observe(el);
		return () => {
			io.disconnect();
			cancelAnimationFrame(raf);
		};
	}, [stat.value]);

	return (
		<Box ref={ref} pos="relative" style={{ zIndex: 10 }}>
			<Stack align="center" gap={12} ta="center">
				<Text fw={800} size="3rem" lh={1} style={{ letterSpacing: "-0.04em" }}>
					<Text
						span
						inherit
						style={{
							backgroundImage: "linear-gradient(to bottom, currentColor, transparent)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						{n}
					</Text>
					<Text
						span
						inherit
						c="var(--mantine-primary-color-6)"
					>
						{stat.suffix}
					</Text>
				</Text>
				<Text
					size="11px"
					fw={600}
					tt="uppercase"
					c="dimmed"
					style={{ maxWidth: "12ch", letterSpacing: "0.22em", lineHeight: 1.6 }}
				>
					{stat.label}
				</Text>
			</Stack>
		</Box>
	);
}

export default function Overview() {
	return (
		<Box component="section" mx="auto" px="md" py={80} style={{ maxWidth: "64rem" }}>
			<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xl">
				{OVERVIEW_STATS.map((s) => (
					<Stat key={s.label} stat={s} />
				))}
			</SimpleGrid>
		</Box>
	);
}
