import { Stack } from "@mantine/core";
import { IconClipboardCheck } from "@tabler/icons-react";
import QuestionnairesTab from "@/components/admin/QuestionnairesTab";
import PageHeader from "@/components/ui/page-header";

export default function AdminQuestionnaires() {
	return (
		<>
			<PageHeader
				title="问卷管理"
				subtitle="管理前后测问卷模板、分配病例、查看数据"
				icon={IconClipboardCheck}
			/>
			<Stack gap="md" mt="md">
				<QuestionnairesTab />
			</Stack>
		</>
	);
}
