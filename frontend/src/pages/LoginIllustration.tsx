import lottie from "lottie-web";
import { Flex } from "@mantine/core";
import { useEffect, useRef } from "react";
import placeholderAnimation from "@/assets/lottie/animation.json";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export default function LoginIllustration() {
	const visible = useMediaQuery("(min-width: 1024px)");
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!visible || !containerRef.current) return;

		const anim = lottie.loadAnimation({
			container: containerRef.current,
			animationData: placeholderAnimation,
			renderer: "svg",
			loop: true,
			autoplay: true,
			rendererSettings: {
				preserveAspectRatio: "xMidYMid meet",
				progressiveLoad: true,
			},
		});
		anim.setSubframe(false);

		return () => anim.destroy();
	}, [visible]);

	if (!visible) return null;

	return (
		<Flex w="50%" justify="center" align="center">
			<div
				ref={containerRef}
				style={{ width: "100%", maxWidth: 448, transform: "translateZ(0)" }}
			/>
		</Flex>
	);
}
