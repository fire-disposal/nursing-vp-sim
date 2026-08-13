import { Box, Group, Loader, Modal, Paper, Text, Typography, UnstyledButton } from "@mantine/core";
import { IconBook2, IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSectionText } from "@/api";


interface Citation {
	source: string;
	section: string;
}

export default function CitationCard({ citations }: { citations: Citation[] }) {
	const [open, setOpen] = useState(false);
	const [modal, setModal] = useState<{ source: string; section: string } | null>(null);
	const [modalText, setModalText] = useState("");
	const [loadingModal, setLoadingModal] = useState(false);

	if (!citations || citations.length === 0) return null;

	const openModal = async (c: Citation) => {
		setModal({ source: c.source, section: c.section });
		setModalText("");
		setLoadingModal(true);
		try {
			const res = await getSectionText(c.source, c.section);
			setModalText(res.data.text || "");
		} catch {
			setModalText("无法加载教材原文");
		} finally {
			setLoadingModal(false);
		}
	};

	return (
		<>
			<Paper mt="sm" withBorder radius="md" style={{ overflow: "hidden" }}>
				<UnstyledButton
					w="100%"
					px="sm"
					py={8}
					onClick={() => setOpen(!open)}
				>
					<Group gap={8} wrap="nowrap">
						<IconBook2 size={12} />
						<Text size="xs" c="dimmed">
							参考教材 ({citations.length})
						</Text>
						<IconChevronDown
							size={12}
							style={{
								marginLeft: "auto",
								transform: open ? "rotate(180deg)" : undefined,
								transition: "transform 200ms",
							}}
						/>
					</Group>
				</UnstyledButton>
				{open && (
					<Box px="sm" py={8} style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
						{citations.map((c, i) => (
							<UnstyledButton
								key={i}
								w="100%"
								ta="left"
								py={4}
								px={6}
								onClick={() => openModal(c)}
							>
								<Text size="xs">
									<span style={{ fontWeight: 500 }}>{c.source}</span>
									<Text component="span" size="xs" c="dimmed">
										{" "}› {c.section}
									</Text>
								</Text>
							</UnstyledButton>
						))}
					</Box>
				)}
			</Paper>

			{modal && (
				<Modal opened onClose={() => setModal(null)} size={768} centered withinPortal>
					<Group gap={8} py="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }} wrap="nowrap">
						<IconBook2 size={14} color="var(--mantine-color-teal-6)" />
						<Box style={{ flex: 1, minWidth: 0 }}>
							<Text size="sm" fw={500}>
								{modal.source}
							</Text>
							<Text size="xs" c="dimmed">
								› {modal.section}
							</Text>
						</Box>
					</Group>
					<Box p="md" style={{ overflowY: "auto" }}>
						{loadingModal ? (
							<Group gap={8} wrap="nowrap">
								<Loader size={14} />
								<Text size="sm" c="dimmed">
									加载中...
								</Text>
							</Group>
						) : (
							<Typography>
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{modalText}
								</ReactMarkdown>
							</Typography>
						)}
					</Box>
				</Modal>
			)}
		</>
	);
}
