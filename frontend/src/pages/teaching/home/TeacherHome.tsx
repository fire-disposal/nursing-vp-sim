import { Button, Group, Stack } from "@mantine/core";
import { exportRecords } from "@/api";
import { TeachingDashboard } from "@/pages/teaching/dashboard/TeachingDashboard";
import { useToast } from "@/components/Toast";

/** 教师首页：教学看板 + 训练记录导出。人员/授予等管理动作不在教师职责内。 */
export default function TeacherHome() {
	const toast = useToast();

	const handleExport = async () => {
		try {
			const { data } = await exportRecords();
			const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = `training_records_${new Date().toISOString().slice(0, 10)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("导出成功");
		} catch {
			toast.error("导出失败");
		}
	};

	return (
		<Stack gap="xl">
			<TeachingDashboard />
			<Group justify="flex-end">
				<Button variant="transparent" size="xs" color="gray" onClick={handleExport}>
					导出训练记录 CSV
				</Button>
			</Group>
		</Stack>
	);
}
