import {
	IconCheck,
	IconExternalLink,
	IconInfoCircle,
	IconLock,
	IconLogout,
	IconMessageCircle,
	IconMoon,
	IconPalette,
	IconPencil,
	IconStethoscope,
	IconSun,
	IconUser,
} from "@tabler/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	Avatar,
	Box,
	Container,
	Divider,
	Group,
	Stack,
	Text,
	ThemeIcon,
	useMantineColorScheme,
	useMantineTheme,
} from "@mantine/core";
import { BRAND_PALETTES } from "@/theme";
import { useBrandStore } from "@/theme/brand-store";
import { changePassword, updateMyProfile } from "@/api";
import { APP_VERSION } from "@/version";
import { useFeedback } from "@/components/FeedbackProvider";
import Button from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
	Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { FormMessageBanner } from "@/components/ui/form-message-banner";
import { Input } from "@/components/ui/input";
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
		resolver: zodResolver(profileSchema),
		defaultValues: {
			displayName: storeUser?.display_name || "",
			studentId: storeUser?.student_id || "",
			gender: storeUser?.gender || "",
		},
	});

	const pwForm = useForm<PasswordChangeFormValues>({
		resolver: zodResolver(passwordChangeSchema),
		defaultValues: { oldPassword: "", newPassword: "" },
	});

	const openEditDialog = () => {
		profileForm.reset({
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
							variant="ghost"
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
							variant="ghost"
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
							variant="ghost"
							color="gray"
							fullWidth
							justify="flex-start"
							h="auto"
							py="sm"
							onClick={() => setThemeOpen(true)}
							leftSection={
								<ThemeIcon size={36} radius="md" variant="light" color="gray">
									<IconPalette size={18} />
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
							variant="ghost"
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
						variant="ghost"
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
				<Dialog open={themeOpen} onOpenChange={(o) => { if (!o) setThemeOpen(false); }}>
					<DialogContent title="主题与外观" maxWidth={420}>
						<Stack gap="lg" mt="xs">
							<Box>
								<Text size="xs" c="dimmed" mb="sm">
									配色方案
								</Text>
								<PalettePicker />
							</Box>
							<Divider />
							<ThemeToggleButton />
						</Stack>
					</DialogContent>
				</Dialog>

				{/* ── Edit profile dialog ── */}
				<Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
					<DialogContent title="编辑资料" maxWidth={480}>
						<FormMessageBanner type={saveMsg.includes("成功") ? "success" : "error"} message={saveMsg} />
						<Form {...profileForm}>
							<form onSubmit={profileForm.handleSubmit(handleSave)}>
								<Stack gap="md" mt="xs">
									<FormField control={profileForm.control} name="displayName"
										render={({ field }) => (
											<FormItem>
												<FormLabel>显示名称</FormLabel>
												<FormControl><Input {...field} /></FormControl>
												<FormMessage />
											</FormItem>
										)} />
									<FormField control={profileForm.control} name="studentId"
										render={({ field }) => (
											<FormItem>
												<FormLabel>学号</FormLabel>
												<FormControl><Input {...field} placeholder="选填" /></FormControl>
												<FormMessage />
											</FormItem>
										)} />
									<FormField control={profileForm.control} name="gender"
										render={({ field }) => (
											<FormItem>
												<FormLabel>性别</FormLabel>
												<Group gap="xs">
													<Button type="button" variant={field.value === "男" ? "default" : "outline"} size="sm"
														onClick={() => field.onChange("男")}>男</Button>
													<Button type="button" variant={field.value === "女" ? "default" : "outline"} size="sm"
														onClick={() => field.onChange("女")}>女</Button>
												</Group>
												<FormMessage />
											</FormItem>
										)} />
									<Group justify="flex-end" gap="xs" pt="xs">
										<Button type="button" variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
										<Button type="submit" loading={profileForm.formState.isSubmitting}>
											保存
										</Button>
									</Group>
								</Stack>
							</form>
						</Form>
					</DialogContent>
				</Dialog>

				{/* ── Password dialog ── */}
				<Dialog open={pwdOpen} onOpenChange={(o) => { if (!o) setPwdOpen(false); }}>
					<DialogContent title="修改密码" maxWidth={480}>
						<FormMessageBanner type={pwdMsg.includes("成功") ? "success" : "error"} message={pwdMsg} />
						<Form {...pwForm}>
							<form onSubmit={pwForm.handleSubmit(handleChangePassword)}>
								<Stack gap="sm" mt="xs">
									<FormField control={pwForm.control} name="oldPassword"
										render={({ field }) => (
											<FormItem>
												<FormLabel>当前密码</FormLabel>
												<FormControl><Input type="password" {...field} /></FormControl>
												<FormMessage />
											</FormItem>
										)} />
									<FormField control={pwForm.control} name="newPassword"
										render={({ field }) => (
											<FormItem>
												<FormLabel>新密码</FormLabel>
												<FormControl><Input type="password" {...field} /></FormControl>
												<FormMessage />
											</FormItem>
										)} />
									<Group justify="flex-end" gap="xs" pt="xs">
										<Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
										<Button type="submit" loading={pwForm.formState.isSubmitting}>
											确认修改
										</Button>
									</Group>
								</Stack>
							</form>
						</Form>
					</DialogContent>
				</Dialog>

				{/* ── About dialog ── */}
				<Dialog open={aboutOpen} onOpenChange={(o) => { if (!o) setAboutOpen(false); }}>
					<DialogContent title="关于系统" maxWidth={420}>
						<Stack gap="md" py="xs" align="center" ta="center">
							<ThemeIcon size={48} radius="xl" variant="filled">
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
								c="teal"
								style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
							>
								查看产品介绍 <IconExternalLink size={14} />
							</Text>
						</Stack>
					</DialogContent>
				</Dialog>
			</Stack>
		</Container>
	);
}

function ThemeToggleButton() {
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();
	const isDark = colorScheme === "dark";
	return (
		<Button
			variant="ghost"
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

function PalettePicker() {
	const theme = useMantineTheme();
	const activeId = useBrandStore((s) => s.brand);
	const setBrand = useBrandStore((s) => s.setBrand);
	return (
		<Group gap="xs" wrap="wrap">
			{BRAND_PALETTES.map((t) => {
				const primary = theme.colors[t.primaryColor][6];
				const accent = theme.colors[t.primaryColor][1];
				const active = activeId === t.id;
				return (
					<Box
						component="button"
						key={t.id}
						type="button"
						onClick={() => setBrand(t.id)}
						title={t.description}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 6,
							padding: 8,
							borderRadius: "var(--mantine-radius-lg)",
							border: `1px solid ${active ? primary : "var(--mantine-color-gray-3)"}`,
							background: active ? `${accent}80` : undefined,
							cursor: "pointer",
						}}
					>
						<Box
							style={{
								width: 32,
								height: 32,
								borderRadius: "50%",
								background: primary,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								boxShadow: "var(--mantine-shadow-md)",
							}}
						>
							{active && <IconCheck size={14} color="white" stroke={3} />}
						</Box>
						<Text size="10px" fw={500} c="dimmed">
							{t.label}
						</Text>
					</Box>
				);
			})}
		</Group>
	);
}
