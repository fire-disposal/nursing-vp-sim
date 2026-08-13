import { Box, Paper, Text } from "@mantine/core";

const nodes = [
	{
		label: "训练引擎",
		detail: "守卫 / 提示 / LLM / 副作用",
		accent: "cyan",
		transform: "translate(-50%, -50%) translateX(-12%) translateY(8%)",
	},
	{
		label: "虚拟患者",
		detail: "角色扮演 / 情绪 / 信息披露",
		accent: "violet",
		transform: "translate(-50%, -50%) translateX(14%) translateY(-10%)",
	},
	{
		label: "透明评分",
		detail: "SSE / 证据 / 可解释反馈",
		accent: "blue",
		transform: "translate(-50%, -50%) translateY(12%)",
	},
];

export default function SystemOrbit() {
	return (
		<Paper
			withBorder
			radius="md"
			p="lg"
			pos="relative"
			style={{ aspectRatio: "4 / 3", overflow: "hidden" }}
		>
			<Box
				style={{
					position: "absolute",
					inset: 0,
					opacity: 0.5,
					backgroundImage:
						"linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)",
					backgroundSize: "48px 48px",
				}}
			/>
			<Box
				style={{
					position: "absolute",
					left: "50%",
					top: "50%",
					width: 224,
					height: 224,
					transform: "translate(-50%, -50%)",
					borderRadius: "50%",
					border: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					opacity: 0.4,
					backdropFilter: "blur(12px)",
				}}
			/>
			<Box
				style={{
					position: "absolute",
					left: "50%",
					top: "50%",
					width: 288,
					height: 288,
					transform: "translate(-50%, -50%)",
					borderRadius: "50%",
					border: "1px dashed var(--mantine-primary-color-2)",
				}}
			/>

			<Box
				pos="relative"
				style={{ zIndex: 10, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
			>
				<Box
					style={{
						position: "absolute",
						width: 224,
						height: 224,
						borderRadius: "50%",
						background: "var(--mantine-primary-color-light)",
						filter: "blur(48px)",
					}}
				/>
				<Box
					style={{
						position: "relative",
						width: 144,
						height: 144,
						borderRadius: "50%",
						border: "1px solid var(--mantine-primary-color-2)",
						background: "var(--mantine-color-body)",
						boxShadow: "var(--mantine-shadow-xl)",
						backdropFilter: "blur(24px)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Box
						style={{
							position: "absolute",
							inset: 12,
							borderRadius: "50%",
							border: "1px dashed var(--mantine-primary-color-2)",
						}}
					/>
					<Box ta="center">
						<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.35em" }}>
							Virtual Patient
						</Text>
						<Text size="2rem" fw={900} mt={8}>
							core
						</Text>
					</Box>
				</Box>

				{nodes.map((node, index) => (
					<Box
						key={node.label}
						style={{
							position: "absolute",
							left: "50%",
							top: "50%",
							transform: node.transform,
							transition: "transform 500ms",
						}}
					>
						<Box
							style={{
								position: "absolute",
								inset: 0,
								borderRadius: "1.75rem",
								background: `var(--mantine-color-${node.accent}-6)`,
								opacity: 0.15,
								filter: "blur(24px)",
							}}
						/>
						<Box
							p="md"
							w={160}
							style={{
								position: "relative",
								borderRadius: "1.75rem",
								border: "1px solid var(--mantine-color-default-border)",
								background: "var(--mantine-color-body)",
								opacity: 0.75,
								boxShadow: "var(--mantine-shadow-lg)",
								backdropFilter: "blur(12px)",
							}}
						>
							<Box
								h={6}
								mb={12}
								style={{
									borderRadius: "9999px",
									background: `var(--mantine-color-${node.accent}-6)`,
								}}
							/>
							<Text size="sm" fw={700}>
								{node.label}
							</Text>
							<Text size="xs" c="dimmed" mt={4} lh={1.6}>
								{node.detail}
							</Text>
							<Box mt="md" style={{ display: "flex", justifyContent: "space-between" }}>
								<Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
									0{index + 1}
								</Text>
								<Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
									live
								</Text>
							</Box>
						</Box>
					</Box>
				))}
			</Box>
		</Paper>
	);
}
