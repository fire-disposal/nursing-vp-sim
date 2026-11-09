import { Button, Checkbox, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import { getPersonas, getUserSchoolPersonas, setUserSchoolPersonas } from "@/api/admin/personas";
import { useToast } from "@/components/Toast";
import { useSchoolsQuery } from "@/hooks/useSchools";
import type { UserBrief } from "./types";

/**
 * 多校视角：给账号在指定院校授予视角。
 *
 * 平台账号可跨校；院校管理员只能本校（后端同样校验）。家院校的授予仍可在编辑用户里改，
 * 这里用于 A 校管理员 + B 校教师这类跨校身份。
 */
export default function SchoolPersonasModal({
	user,
	opened,
	onClose,
}: {
	user: UserBrief | null;
	opened: boolean;
	onClose: () => void;
}) {
	const toast = useToast();
	const { data: schools = [] } = useSchoolsQuery({ enabled: opened });
	const [schoolId, setSchoolId] = useState<string | null>(null);
	const [personas, setPersonas] = useState<string[]>([]);
	const [presets, setPresets] = useState<{ value: string; label: string }[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!opened) return;
		getPersonas()
			.then((r) =>
				setPresets(
					r.data
						// 平台视角只属于平台账号（目标在这里必然不是）；超出调用者权限的档位
						// 后端会 403，前端也不该给出可勾选项。
						.filter((p) => p.key !== "platform" && p.grantable)
						.map((p) => ({ value: p.key, label: p.label })),
				),
			)
			.catch(() => toast.error("视角目录加载失败"));
	}, [opened]);

	useEffect(() => {
		if (!opened || !user || !schoolId) return;
		setLoading(true);
		getUserSchoolPersonas(user.id, Number(schoolId))
			.then((r) => setPersonas(r.data.personas))
			.catch(() => toast.error("院校授予加载失败"))
			.finally(() => setLoading(false));
	}, [opened, user, schoolId]);

	const save = async () => {
		if (!user || !schoolId) return;
		setLoading(true);
		try {
			await setUserSchoolPersonas(user.id, Number(schoolId), personas);
			toast.success("院校视角已保存");
			onClose();
		} catch (err) {
			toast.apiError(err, "保存失败");
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal opened={opened} onClose={onClose} title={`多校视角 · ${user?.display_name ?? ""}`} centered>
			<Stack gap="md">
				<Text size="xs" c="dimmed">
					选择院校后勾选该账号在该校可使用的视角。院校管理员只能授予本校；跨校授予仅平台账号可做。
				</Text>
				<Select
					label="院校"
					placeholder="选择院校"
					searchable
					data={schools.map((school) => ({ value: String(school.id), label: school.name }))}
					value={schoolId}
					onChange={setSchoolId}
				/>
				<Checkbox.Group label="视角" value={personas} onChange={setPersonas}>
					<Stack gap={6} mt={4}>
						{presets.map((preset) => (
							<Checkbox key={preset.value} value={preset.value} label={preset.label} />
						))}
					</Stack>
				</Checkbox.Group>
				<Group justify="flex-end">
					<Button variant="default" onClick={onClose}>
						取消
					</Button>
					<Button loading={loading} disabled={!schoolId} onClick={save}>
						保存
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
