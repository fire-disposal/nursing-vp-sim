import { Badge, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LiveChatSimulation from "../components/LiveChatSimulation";
import VideoModal from "../components/VideoModal";
import VirtualPatientMaskText from "../components/VirtualPatientMaskText";
import { CTA_HREF, CTA_LABEL, HERO_TITLE, PRODUCT_NAME } from "../data";
import { ensureGsap, prefersReducedMotion } from "../gsap";

export default function Hero() {
	const root = useRef<HTMLElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const ctaRef = useRef<HTMLDivElement>(null);
	const [videoOpen, setVideoOpen] = useState(false);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
			gsap.to(panel.current, {
				yPercent: -8,
				ease: "none",
				scrollTrigger: {
					trigger: root.current,
					start: "top top",
					end: "bottom top",
					scrub: true,
				},
			});

			// Entrance animations
			const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
			tl.from(titleRef.current, { y: 40, opacity: 0, duration: 1 })
				.from(ctaRef.current, { y: 20, opacity: 0, duration: 0.8 }, "-=0.6")
				.from(panel.current, { scale: 0.98, opacity: 0, duration: 1.1 }, "-=1");
		}, root);
		return () => ctx.revert();
	}, []);

	return (
		<>
			<Box
				component="section"
				ref={root}
				pos="relative"
				style={{
					minHeight: "calc(100dvh - 64px)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					overflow: "hidden",
					paddingTop: "calc(2.75rem + 5px)",
					paddingBottom: "4rem",
				}}
			>
				<Box pos="absolute" inset={0} style={{ pointerEvents: "none", zIndex: -10 }}>
					<Box
						style={{
							position: "absolute",
							left: "50%",
							top: 0,
							width: "28rem",
							height: "28rem",
							transform: "translateX(-50%)",
							borderRadius: "50%",
							background: "var(--mantine-primary-color-6)",
							opacity: 0.05,
							filter: "blur(140px)",
						}}
					/>
					<Box
						style={{
							position: "absolute",
							right: 0,
							top: "33%",
							width: "18rem",
							height: "18rem",
							borderRadius: "50%",
							background: "var(--mantine-color-blue-5)",
							opacity: 0.06,
							filter: "blur(120px)",
						}}
					/>
				</Box>

				<SimpleGrid
					cols={{ base: 1, lg: 2 }}
					spacing={{ base: 56, lg: 80 }}
					mx="auto"
					px="md"
					w="100%"
					style={{ maxWidth: "80rem" }}
				>
					<Stack gap="lg" pt={4}>
						<Box>
							<Badge variant="light" radius="xl" tt="uppercase" fw={700} size="sm" style={{ letterSpacing: "0.1em" }}>
								{PRODUCT_NAME}
							</Badge>
						</Box>
						<Title
							ref={titleRef}
							order={1}
							aria-label={HERO_TITLE}
							fw={700}
							lh={1.03}
							style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", letterSpacing: "-0.02em" }}
						>
							把 LLM 做成可教学、可评估的
							<VirtualPatientMaskText />
						</Title>
						<Group gap={12}>
							{["5 个面板", "19 项评分", "6 种情绪", "教材溯源"].map((item) => (
								<Badge key={item} variant="default" radius="xl">
									{item}
								</Badge>
							))}
						</Group>
						<Text size="sm" c="dimmed" style={{ maxWidth: "46ch" }}>
							从问诊提问、病史暴露到评分证据回链，训练过程、结果和依据都能直接查看。
						</Text>
						<Group ref={ctaRef} gap={20}>
							<Button
								component={Link}
								to={CTA_HREF}
								size="lg"
								radius="xl"
								px={40}
								h={56}
								fw={600}
								style={{
									boxShadow:
										"0 20px 40px -20px var(--mantine-primary-color-filled)",
								}}
							>
								{CTA_LABEL}
							</Button>
						</Group>
					</Stack>
					<Box ref={panel} pos="relative" pt={{ base: 0, lg: 32 }}>
						<Paper
							withBorder
							radius="xl"
							p={{ base: "lg", md: "xl" }}
							pos="relative"
							style={{ overflow: "hidden" }}
						>
							<LiveChatSimulation />
						</Paper>
					</Box>
				</SimpleGrid>
			</Box>
			<VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} src="/demo.mp4" />
		</>
	);
}
