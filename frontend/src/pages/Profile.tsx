import { Key, Loader2, Save, User } from "lucide-react";
import { useState } from "react";
import { changePassword, updateMyProfile } from "@/api/api-client";
import Button from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";

export default function Profile() {
	const storeUser = useAuthStore((s) => s.user);
	const refreshUser = useAuthStore((s) => s.refreshUser);

	const [displayName, setDisplayName] = useState(storeUser?.display_name || "");
	const [gender, setGender] = useState(storeUser?.gender || "");
	const [avatarValue, _setAvatarValue] = useState(storeUser?.avatar || "");
	const [studentId, setStudentId] = useState(storeUser?.student_id || "");
	const [saving, setSaving] = useState(false);
	const [saveMsg, setSaveMsg] = useState("");

	const [pwdOpen, setPwdOpen] = useState(false);
	const [oldPwd, setOldPwd] = useState("");
	const [newPwd, setNewPwd] = useState("");
	const [pwdMsg, setPwdMsg] = useState("");
	const [pwdLoading, setPwdLoading] = useState(false);

	const previewAvatar = getUserAvatar(gender);

	const handleSave = async () => {
		setSaveMsg("");
		setSaving(true);
		try {
			await updateMyProfile({
				display_name: displayName || null,
				gender: gender || null,
				avatar: avatarValue || null,
				student_id: studentId || null,
			});
			await refreshUser();
			setSaveMsg("保存成功");
			setTimeout(() => setSaveMsg(""), 2000);
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setSaveMsg(e.response?.data?.detail || "保存失败");
		} finally {
			setSaving(false);
		}
	};

	const handleChangePassword = async () => {
		setPwdMsg("");
		if (!oldPwd || !newPwd) {
			setPwdMsg("请填写完整");
			return;
		}
		if (newPwd.length < 6) {
			setPwdMsg("新密码至少 6 个字符");
			return;
		}
		setPwdLoading(true);
		try {
			await changePassword(oldPwd, newPwd);
			setPwdMsg("密码修改成功");
			setTimeout(() => {
				setPwdOpen(false);
				setOldPwd("");
				setNewPwd("");
				setPwdMsg("");
			}, 1000);
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setPwdMsg(e.response?.data?.detail || "修改失败");
		} finally {
			setPwdLoading(false);
		}
	};

	return (
		<div className="mx-auto max-w-2xl">
			<PageHeader
				title="个人资料"
				subtitle="管理你的个人信息与安全"
				icon={User}
			/>

			{saveMsg && (
				<div
					className={cn(
						"mb-4 px-4 py-3 rounded-lg text-sm",
						saveMsg.includes("成功")
							? "bg-success text-success-foreground"
							: "bg-destructive/10 text-destructive",
					)}
				>
					{saveMsg}
				</div>
			)}

			<div className="space-y-6">
				<div className="rounded-xl border border-border bg-card p-6">
					<div className="flex flex-col items-center gap-4">
						<img
							src={previewAvatar}
							alt="头像"
							className="size-24 rounded-full object-cover ring-2 ring-border bg-muted"
						/>
						<div className="flex gap-2">
							<Button
								variant={gender === "男" ? "default" : "outline"}
								size="sm"
								onClick={() => setGender("男")}
							>
								男
							</Button>
							<Button
								variant={gender === "女" ? "default" : "outline"}
								size="sm"
								onClick={() => setGender("女")}
							>
								女
							</Button>
						</div>
					</div>
				</div>

				<div className="rounded-xl border border-border bg-card p-6">
					<h3 className="mb-4 text-sm font-semibold">基本信息</h3>
					<div className="space-y-4">
						<div>
							<label className="block text-sm font-medium mb-1.5">用户名</label>
							<Input
								value={storeUser?.username || ""}
								disabled
								className="h-10 bg-muted/50"
							/>
							<p className="mt-1 text-xs text-muted-foreground">
								用户名不可修改
							</p>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1.5">
								显示名称
							</label>
							<Input
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="输入你的显示名称"
								className="h-10"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1.5">学号</label>
							<Input
								value={studentId}
								onChange={(e) => setStudentId(e.target.value)}
								placeholder="输入学号（选填）"
								className="h-10"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1.5">角色</label>
							<Input
								value={storeUser?.role_display_name || storeUser?.role || ""}
								disabled
								className="h-10 bg-muted/50"
							/>
						</div>
						{storeUser?.school_name && (
							<div>
								<label className="block text-sm font-medium mb-1.5">学校</label>
								<Input
									value={storeUser.school_name}
									disabled
									className="h-10 bg-muted/50"
								/>
							</div>
						)}
					</div>
				</div>

				<div className="rounded-xl border border-border bg-card p-6">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-sm font-semibold">账户安全</h3>
							<p className="mt-1 text-xs text-muted-foreground">修改登录密码</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPwdOpen(true)}
						>
							<Key size={14} />
							修改密码
						</Button>
					</div>
				</div>

				<div className="flex justify-end">
					<Button onClick={handleSave} disabled={saving} className="min-w-28">
						{saving ? (
							<Loader2 size={16} className="animate-spin" />
						) : (
							<Save size={16} />
						)}
						保存
					</Button>
				</div>
			</div>

			<Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="修改密码">
				<div className="space-y-3 py-2">
					{pwdMsg && (
						<div
							className={cn(
								"px-3 py-2 rounded-lg text-sm",
								pwdMsg.includes("成功")
									? "bg-success text-success-foreground"
									: "bg-destructive/10 text-destructive",
							)}
						>
							{pwdMsg}
						</div>
					)}
					<div>
						<label className="block text-sm font-medium mb-1">原密码</label>
						<Input
							type="password"
							value={oldPwd}
							onChange={(e) => setOldPwd(e.target.value)}
							placeholder="输入原密码"
							className="h-10"
						/>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">新密码</label>
						<Input
							type="password"
							value={newPwd}
							onChange={(e) => setNewPwd(e.target.value)}
							placeholder="至少 6 个字符"
							className="h-10"
						/>
					</div>
					<Button
						className="w-full"
						onClick={handleChangePassword}
						disabled={pwdLoading}
					>
						{pwdLoading ? "修改中..." : "确认修改"}
					</Button>
				</div>
			</Modal>
		</div>
	);
}
