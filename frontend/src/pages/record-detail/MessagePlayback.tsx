import { Paper, Stack, Text, Title } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";

export interface MessageData {
	id: number;
	role: string;
	content: string;
}

interface Props {
	messages: MessageData[];
}

export default function MessagePlayback({ messages }: Props) {
	return (
		<Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
			<Title order={3} size="sm" mb="md" style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<IconMessageCircle size={18} />
				对话回放 ({messages.length}条消息)
			</Title>
			<Paper
				withBorder={false}
				bg="gray.1"
				p={{ base: "md", sm: "lg" }}
				style={{ maxHeight: 400, overflowY: "auto" }}
			>
				<Stack gap="xs">
					{messages.map((msg) => (
						<Text key={msg.id} size="sm" lh={1.6}>
							<Text
								component="span"
								fw={600}
								mr={8}
								c={msg.role === "student" ? "blue" : "blue"}
							>
								{msg.role === "student" ? "学生：" : "患者："}
							</Text>
							<Text component="span" c="gray.7">
								{msg.content}
							</Text>
						</Text>
					))}
				</Stack>
			</Paper>
		</Paper>
	);
}
