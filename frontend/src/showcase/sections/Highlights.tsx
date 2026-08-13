import { Badge, Box, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { useEffect, useRef } from "react";
import ConversationSnippets from "../components/ConversationSnippets";
import EmotionMatrix from "../components/EmotionMatrix";
import FeatureFull from "../components/layouts/FeatureFull";
import FeatureSplit from "../components/layouts/FeatureSplit";
import ProcessPipeline from "../components/ProcessPipeline";
import ScoreStream from "../components/ScoreStream";
import SectionHeading from "../components/SectionHeading";
import VoicePlayback from "../components/VoicePlayback";
import { HIGHLIGHTS, type Highlight } from "../data";
import { ensureGsap, prefersReducedMotion } from "../gsap";

const RAG_DOCS = [
	{ name: "内科护理学", ch: "循环系统疾病病人的护理", match: "92%" },
	{ name: "健康评估", ch: "胸部体格检查", match: "87%" },
	{ name: "基础护理学", ch: "护患沟通技巧", match: "74%" },
];

function visualFor(h: Highlight) {
	if (h.id === "engine") return <ProcessPipeline />;
	if (h.id === "patient") return <ConversationSnippets />;
	if (h.id === "emotion") return <EmotionMatrix />;
	if (h.id === "scoring") return <ScoreStream />;
	if (h.id === "voice") return <VoicePlayback />;
	if (h.id === "rag")
		return (
			<Paper withBorder radius="md" p="lg" pos="relative" style={{ overflow: "hidden" }}>
				<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
					<Stack gap={4}>
						<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
							知识检索
						</Text>
						<Text size="lg" fw={700}>
							Tool Call · 教材溯源
						</Text>
					</Stack>
					<Badge
						variant="default"
						radius="xl"
						leftSection={<Box w={6} h={6} style={{ borderRadius: "50%", background: "var(--mantine-color-orange-6)" }} />}
					>
						RAG
					</Badge>
				</Group>
				<Box
					p="md"
					mt="md"
					pos="relative"
					style={{
						zIndex: 10,
						border: "1px solid var(--mantine-color-default-border)",
						borderRadius: "var(--mantine-radius-md)",
						background: "var(--mantine-color-gray-0)",
					}}
				>
					<Text
						size="xs"
						c="var(--mantine-primary-color-6)"
						mb={8}
						style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
					>
						$ browse_chapter "内科护理学"
					</Text>
					<Stack gap={8}>
						{RAG_DOCS.map((doc, i) => (
							<Group
								key={i}
								justify="space-between"
								px={12}
								py={10}
								style={{
									borderRadius: "var(--mantine-radius-md)",
									background: "var(--mantine-color-body)",
								}}
							>
								<Box>
									<Text size="xs" fw={500}>
										{doc.name}
									</Text>
									<Text size="xs" c="dimmed" opacity={0.7}>
										{doc.ch}
									</Text>
								</Box>
								<Badge variant="light" radius="xl">
									{doc.match}
								</Badge>
							</Group>
						))}
					</Stack>
				</Box>
			</Paper>
		);
	return null;
}

function StickyHighlight({ h }: { h: Highlight }) {
	const root = useRef<HTMLDivElement>(null);
	const card = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
			const mm = gsap.matchMedia();
			mm.add("(min-width: 768px)", () => {
				gsap.fromTo(
					card.current,
					{ y: 50, opacity: 0.9 },
					{
						y: 0,
						opacity: 1,
						ease: "power2.out",
						scrollTrigger: {
							trigger: root.current,
							start: "top bottom-=100",
							end: "top center",
							scrub: true,
						},
					},
				);
			});
		}, root);
		return () => ctx.revert();
	}, []);

	const Icon = h.icon;
	return (
		<Box ref={root} py="lg">
			<Paper
				ref={card}
				withBorder
				radius="md"
				style={{ overflow: "hidden" }}
			>
				<Stack gap="xl" p={{ base: "lg", md: "xl", lg: "3rem" }}>
					<Group gap={20}>
						<ThemeIcon size={56} radius="md" variant="filled">
							<Icon size={28} strokeWidth={1.5} />
						</ThemeIcon>
						<Title order={3} fw={800} size="2rem">
							{h.title}
						</Title>
					</Group>
					<Text size="lg" c="dimmed" style={{ maxWidth: "55ch" }}>
						{h.body}
					</Text>
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
						{h.points.map((p) => (
							<Group
								key={p}
								gap={12}
								p="md"
								align="flex-start"
								wrap="nowrap"
								style={{
									border: "1px solid var(--mantine-color-default-border)",
									borderRadius: "var(--mantine-radius-md)",
									background: "var(--mantine-color-gray-0)",
								}}
							>
								<Box
									style={{
										marginTop: 7,
										width: 6,
										height: 6,
										borderRadius: "50%",
										background: "var(--mantine-primary-color-6)",
										flexShrink: 0,
									}}
								/>
								<Text size="sm" fw={500}>
									{p}
								</Text>
							</Group>
						))}
					</SimpleGrid>
					<Box pos="relative" mt="md">
						{visualFor(h)}
					</Box>
				</Stack>
			</Paper>
		</Box>
	);
}

export default function Highlights() {
	return (
		<Box mx="auto" px="md" py={48} style={{ maxWidth: "80rem" }}>
			<SectionHeading eyebrow="核心能力" title="六大技术亮点" mb="md" />
			<Stack gap={80}>
				{HIGHLIGHTS.map((h) => {
					if (h.layout === "full")
						return <FeatureFull key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={visualFor(h)} />;
					if (h.layout === "split")
						return <FeatureSplit key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={visualFor(h)} />;
					if (h.layout === "split-reverse")
						return (
							<FeatureSplit
								key={h.id}
								icon={h.icon}
								title={h.title}
								body={h.body}
								points={h.points}
								reverse
								visual={visualFor(h)}
							/>
						);
					if (h.layout === "sticky") return <StickyHighlight key={h.id} h={h} />;
					return null;
				})}
			</Stack>
		</Box>
	);
}
