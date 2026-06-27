import { zodResolver } from "@hookform/resolvers/zod";
import { Key, Loader2, Save, User } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { changePassword, updateMyProfile } from "@/api/api-client";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { FormMessageBanner } from "@/components/ui/form-message-banner";
import { Input } from "@/components/ui/input";
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

	const [avatarValue, _setAvatarValue] = useState(storeUser?.avatar || "");
	const [saveMsg, setSaveMsg] = useState("");

	const [pwdOpen, setPwdOpen] = useState(false);
	const [pwdMsg, setPwdMsg] = useState("");

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

	const handleSave = async (values: ProfileFormValues) => {
		setSaveMsg("");
		try {
			await updateMyProfile({
				display_name: values.displayName || null,
				gender: values.gender || null,
				avatar: avatarValue || null,
				student_id: values.studentId || null,
			});
			await refreshUser();
			setSaveMsg("保存成功");
			setTimeout(() => setSaveMsg(""), 2000);
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
			setTimeout(() => {
				setPwdOpen(false);
				pwForm.reset();
				setPwdMsg("");
			}, 1000);
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

	return (
		<div className="mx-auto max-w-2xl">
			<PageHeader
				title="个人资料"
				subtitle="管理你的个人信息与安全"
				icon={User}
			/>

			<FormMessageBanner
				type={saveMsg.includes("成功") ? "success" : "error"}
				message={saveMsg}
			/>

			<Form {...profileForm}>
				<form
					onSubmit={profileForm.handleSubmit(handleSave)}
					className="space-y-6"
				>
					<div className="rounded-xl border border-border bg-card p-6">
						<FormField
							control={profileForm.control}
							name="gender"
							render={({ field }) => (
								<div className="flex flex-col items-center gap-4">
									<img
										src={getUserAvatar(field.value)}
										alt="头像"
										className="size-24 rounded-full object-cover ring-2 ring-border bg-muted"
									/>
									<div className="flex gap-2">
										<Button
											type="button"
											variant={field.value === "男" ? "default" : "outline"}
											size="sm"
											onClick={() => field.onChange("男")}
										>
											男
										</Button>
										<Button
											type="button"
											variant={field.value === "女" ? "default" : "outline"}
											size="sm"
											onClick={() => field.onChange("女")}
										>
											女
										</Button>
									</div>
								</div>
							)}
						/>
					</div>

					<div className="rounded-xl border border-border bg-card p-6">
						<h3 className="mb-4 text-sm font-semibold">基本信息</h3>
						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium mb-1.5">
									用户名
								</label>
								<Input
									value={storeUser?.username || ""}
									disabled
									className="h-10 bg-muted/50"
								/>
								<p className="mt-1 text-xs text-muted-foreground">
									用户名不可修改
								</p>
							</div>
							<FormField
								control={profileForm.control}
								name="displayName"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="block text-sm font-medium mb-1.5">
											显示名称
										</FormLabel>
										<FormControl>
											<Input
												placeholder="输入你的显示名称"
												className="h-10"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={profileForm.control}
								name="studentId"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="block text-sm font-medium mb-1.5">
											学号
										</FormLabel>
										<FormControl>
											<Input
												placeholder="输入学号（选填）"
												className="h-10"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div>
								<label className="block text-sm font-medium mb-1.5">角色</label>
								<Input
									value={storeUser?.role_display_name || storeUser?.role || ""}
									disabled
									className="h-10 bg-muted/50"
								/>
							</div>
						</div>
					</div>

					<div className="rounded-xl border border-border bg-card p-6">
						<div className="flex items-center justify-between">
							<div>
								<h3 className="text-sm font-semibold">账户安全</h3>
								<p className="mt-1 text-xs text-muted-foreground">修改登录密码</p>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={openPasswordDialog}
							>
								<Key size={14} />
								修改密码
							</Button>
						</div>
					</div>

					<div className="flex justify-end">
						<Button
							type="submit"
							disabled={profileForm.formState.isSubmitting}
							className="min-w-28"
						>
							{profileForm.formState.isSubmitting ? (
								<Loader2 size={16} className="animate-spin" />
							) : (
								<Save size={16} />
							)}
							保存
						</Button>
					</div>
				</form>
			</Form>

			<Dialog open={pwdOpen} onOpenChange={(o) => !o && setPwdOpen(false)}>
				<DialogContent title="修改密码" maxWidth={560}>
					<Form {...pwForm}>
						<form
							onSubmit={pwForm.handleSubmit(handleChangePassword)}
							className="space-y-3 py-2"
						>
							<FormMessageBanner
								type={pwdMsg.includes("成功") ? "success" : "error"}
								message={pwdMsg}
							/>
							<FormField
								control={pwForm.control}
								name="oldPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="block text-sm font-medium mb-1">
											原密码
										</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder="输入原密码"
												className="h-10"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={pwForm.control}
								name="newPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="block text-sm font-medium mb-1">
											新密码
										</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder="至少 6 个字符"
												className="h-10"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<Button
								type="submit"
								className="w-full"
								disabled={pwForm.formState.isSubmitting}
							>
								{pwForm.formState.isSubmitting ? "修改中..." : "确认修改"}
							</Button>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
