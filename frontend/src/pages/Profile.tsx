import {
	IconExternalLink,
	IconInfoCircle,
	IconLock,
	IconLogout,
	IconMessageCircle,
	IconMoon,
	IconPencil,
	IconStethoscope,
	IconSun,
	IconUser,
} from "@tabler/icons-react";
import { schemaResolver, useForm } from "@mantine/form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	Avatar,
	Box,
	Button,
	Container,
	Divider,
	Group,
	Modal,
	Stack,
	Text,
	ThemeIcon,
	useMantineColorScheme,
} from "@mantine/core";
import { changePassword, updateMyProfile } from "@/api";
import { APP_VERSION } from "@/version";
import { useFeedback } from "@/components/FeedbackProvider";
import { Card } from "@/components/ui/card";
import { FormMessageBanner } from "@/components/ui/form-message-banner";
import { TextInput } from "@mantine/core";
import ProfileTabs from "@/components/shell/ProfileTabs";
import PageHeader from "@/components/ui/page-header";
import {
	type PasswordChangeFormValues,
	type ProfileFormValues,
	passwordChangeSchema,
	profileSchema,
} from "@/schemas/profile";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";

export default function Profile() {
	const storeUser = useAuthStore((s) => s.user);
	const refreshUser = useAuthStore((s) => s.refreshUser);
	const logout = useAuthStore((s) => s.logout);
	const { openFeedback } = useFeedback();
	const navigate = useNavigate();

	const [editOpen, setEditOpen] = useState(false);
	const [saveMsg, setSaveMsg] = useState("");
	const [pwdOpen, setPwdOpen] = useState(false);
	const [pwdMsg, setPwdMsg] = useState("");
	const [themeOpen, setThemeOpen] = useState(false);
	const [aboutOpen, setAboutOpen] = useState(false);

	const profileForm = useForm<ProfileFormValues>({
		initialValues: {
			displayName: storeUser?.display_name || "",
			studentId: storeUser?.student_id || "",
			gender: storeUser?.gender || "",
		},
		validate: schemaResolver(profileSchema),
	});

	const pwForm = useForm<PasswordChangeFormValues>({
		initialValues: { oldPassword: "", newPassword: "" },
		validate: schemaResolver(passwordChangeSchema),
	});

	const openEditDialog = () => {
		profileForm.setValues({
			displayName: storeUser?.display_name || "",
			studentId: storeUser?.student_id || "",
			gender: storeUser?.gender || "",
		});
		setSaveMsg("");
		setEditOpen(true);
	};

	const handleSave = async (values: ProfileFormValues) => {
		setSaveMsg("");
		try {
			await updateMyProfile({
				display_name: values.displayName || null,
				gender: values.gender || null,
				avatar: null,
				student_id: values.studentId || null,
			});
			await refreshUser();
			setSaveMsg("保存成功");
			setTimeout(() => { setEditOpen(false); setSaveMsg(""); }, 800);
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setSaveMsg(e.response?.data?.detail || "保存失败");
		}
	};

	const handleChangePassword = async (values: PasswordChangeFormValues) => {
		setPwdMsg("");
		try {
			await changePassword(values.oldPassword, values.newPassword);
			setPwdMsg("密码修改成功");
			setTimeout(() => { setPwdOpen(false); pwForm.reset(); setPwdMsg(""); }, 1000);
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setPwdMsg(e.response?.data?.detail || "修改失败");
		}
	};

	const openPasswordDialog = () => {
		pwForm.reset();
		setPwdMsg("");
		setPwdOpen(true);
	};

	const avatar = getUserAvatar(storeUser?.gender);

	return (
		<Container size="sm" py="md">
			<Stack gap="md">
				<ProfileTabs />
				<PageHeader title="个人中心" subtitle="管理你的账户与偏好" icon={IconUser} />

				{/* ── Profile info ── */}
				<Card>
					<Group gap="md" wrap="nowrap">
						<Avatar src={avatar} alt="头像" size={56} radius="xl" />
						<Box style={{ minWidth: 0, flex: 1 }}>
							<Text size="md" fw={600}>
								{storeUser?.display_name || "-"}
							</Text>
							<Text size="sm" c="dimmed" mt={2}>
								{storeUser?.role_display_name || storeUser?.role || "用户"}
								{storeUser?.username && <> · @{storeUser.username}</>}
							</Text>
							{storeUser?.student_id && (
								<Text size="xs" c="dimmed" mt={2}>
									学号: {storeUser.student_id}
								</Text>
							)}
						</Box>
						<Button variant="outline" size="sm" onClick={openEditDialog}>
							<IconPencil size={14} />
							编辑
						</Button>
					</Group>
				</Card>

				{/* ── Actions ── */}
				<Card>
					<Stack gap={0}>
						<Button
							variant="subtle"
							color="gray"
							fullWidth
							justify="flex-start"
							h="auto"
							py="sm"
							onClick={openPasswordDialog}
							leftSection={
								<ThemeIcon size={36} radius="md" variant="light" color="gray">
									<IconLock size={18} />
								</ThemeIcon>
							}
						>
							<Box style={{ textAlign: "left" }}>
								<Text size="sm" fw={500}>
									修改密码
								</Text>
								<Text size="xs" c="dimmed">
									定期更换密码保护账户安全
								</Text>
							</Box>
						</Button>
						<Divider />
						<Button
							variant="subtle"
							color="gray"
							fullWidth
							justify="flex-start"
							h="auto"
							py="sm"
							onClick={openFeedback}
							leftSection={
								<ThemeIcon size={36} radius="md" variant="light" color="gray">
									<IconMessageCircle size={18} />
								</ThemeIcon>
							}
						>
							<Box style={{ textAlign: "left" }}>
								<Text size="sm" fw={500}>
									意见反馈
								</Text>
								<Text size="xs" c="dimmed">
									报告问题或提出改进建议
								</Text>
							</Box>
						</Button>
						<Divider />
						<Button
							variant="subtle"
							color="gray"
							fullWidth
							justify="flex-start"
							h="auto"
							py="sm"
							onClick={() => setThemeOpen(true)}
							leftSection={
								<ThemeIcon size={36} radius="md" variant="light" color="gray">
									<IconSun size={18} />
								</ThemeIcon>
							}
						>
							<Box style={{ textAlign: "left" }}>
								<Text size="sm" fw={500}>
									主题与外观
								</Text>
								<Text size="xs" c="dimmed">
									配色方案与深浅模式
								</Text>
							</Box>
						</Button>
						<Divider />
						<Button
							variant="subtle"
							color="gray"
							fullWidth
							justify="flex-start"
							h="auto"
							py="sm"
							onClick={() => setAboutOpen(true)}
							leftSection={
								<ThemeIcon size={36} radius="md" variant="light" color="gray">
									<IconInfoCircle size={18} />
								</ThemeIcon>
							}
						>
							<Box style={{ textAlign: "left" }}>
								<Text size="sm" fw={500}>
									关于系统
								</Text>
								<Text size="xs" c="dimmed">
									版本 {APP_VERSION}
								</Text>
							</Box>
						</Button>
					</Stack>
				</Card>

				{/* ── Logout ── */}
				<Card>
					<Button
						variant="subtle"
						color="red"
						fullWidth
						justify="flex-start"
						h="auto"
						py="sm"
						onClick={() => { logout(); navigate("/login"); }}
						leftSection={
							<ThemeIcon size={36} radius="md" variant="light" color="red">
								<IconLogout size={18} />
							</ThemeIcon>
						}
					>
						<Box style={{ textAlign: "left" }}>
							<Text size="sm" fw={500}>
								退出登录
							</Text>
							<Text size="xs" opacity={0.7}>
								安全退出当前账号
							</Text>
						</Box>
					</Button>
				</Card>

				{/* ── Theme dialog ── */}
				<Modal opened={themeOpen} onClose={() => setThemeOpen(false)} title="主题与外观" size={420} centered withinPortal>
						<Stack gap="lg" mt="xs">
							<Divider />
							<ThemeToggleButton />
						</Stack>
				</Modal>

				{/* ── Edit profile dialog ── */}
				<Modal opened={editOpen} onClose={() => setEditOpen(false)} title="编辑资料" size={480} centered withinPortal>
						<FormMessageBanner type={saveMsg.includes("成功") ? "success" : "error"} message={saveMsg} />
						<form onSubmit={profileForm.onSubmit(handleSave)}>
							<Stack gap="md" mt="xs">
								<TextInput label="显示名称" {...profileForm.getInputProps("displayName")} />
								<TextInput label="学号" placeholder="选填" {...profileForm.getInputProps("studentId")} />
								<Box>
									<Text component="label" size="sm" fw={500} mb={4}>性别</Text>
									<Group gap="xs">
										<Button type="button" variant={profileForm.values.gender === "男" ? "filled" : "outline"} size="sm"
											onClick={() => profileForm.setFieldValue("gender", "男")}>男</Button>
										<Button type="button" variant={profileForm.values.gender === "女" ? "filled" : "outline"} size="sm"
											onClick={() => profileForm.setFieldValue("gender", "女")}>女</Button>
									</Group>
									{profileForm.errors.gender && <Text c="red" size="xs" mt={4}>{profileForm.errors.gender}</Text>}
								</Box>
								<Group justify="flex-end" gap="xs" pt="xs">
									<Button type="button" variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
									<Button type="submit" loading={profileForm.submitting}>
										保存
									</Button>
								</Group>
							</Stack>
						</form>
				</Modal>

				{/* ── Password dialog ── */}
				<Modal opened={pwdOpen} onClose={() => setPwdOpen(false)} title="修改密码" size={480} centered withinPortal>
						<FormMessageBanner type={pwdMsg.includes("成功") ? "success" : "error"} message={pwdMsg} />
						<form onSubmit={pwForm.onSubmit(handleChangePassword)}>
							<Stack gap="sm" mt="xs">
								<TextInput type="password" label="当前密码" {...pwForm.getInputProps("oldPassword")} />
								<TextInput type="password" label="新密码" {...pwForm.getInputProps("newPassword")} />
								<Group justify="flex-end" gap="xs" pt="xs">
									<Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
									<Button type="submit" loading={pwForm.submitting}>
										确认修改
									</Button>
								</Group>
							</Stack>
						</form>
				</Modal>

				{/* ── About dialog ── */}
				<Modal opened={aboutOpen} onClose={() => setAboutOpen(false)} title="关于系统" size={420} centered withinPortal>
						<Stack gap="md" py="xs" align="center" ta="center">
							<ThemeIcon size={48} radius="md" variant="filled">
								<IconStethoscope size={24} />
							</ThemeIcon>
							<Box>
								<Text size="lg" fw={600}>
									虚拟患者系统
								</Text>
								<Text size="sm" c="dimmed" mt={4}>
									护理病史采集技能训练平台
								</Text>
								<Text size="xs" c="dimmed" mt="sm">
									版本 {APP_VERSION}
								</Text>
							</Box>
							<Text
								component="a"
								href="/showcase"
								target="_blank"
								rel="noopener noreferrer"
								size="sm"
								c="blue"
								style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
							>
								查看产品介绍 <IconExternalLink size={14} />
							</Text>
						</Stack>
				</Modal>
			</Stack>
		</Container>
	);
}

function ThemeToggleButton() {
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();
	const isDark = colorScheme === "dark";
	return (
		<Button
			variant="subtle"
			color="gray"
			fullWidth
			justify="flex-start"
			h="auto"
			py="sm"
			onClick={toggleColorScheme}
			leftSection={
				<ThemeIcon size={36} radius="md" variant="light" color="gray">
					{isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
				</ThemeIcon>
			}
		>
			<Box style={{ textAlign: "left" }}>
				<Text size="sm" fw={500}>
					{isDark ? "浅色模式" : "深色模式"}
				</Text>
				<Text size="xs" c="dimmed">
					切换界面颜色主题
				</Text>
			</Box>
		</Button>
	);
}

