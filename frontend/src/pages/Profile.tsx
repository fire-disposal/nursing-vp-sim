import { Check, ExternalLink, Info, Loader2, LogOut, Moon, Palette, Pencil, Stethoscope, Sun, User } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { usePalette } from "@/hooks/useTheme";
import { changePassword, updateMyProfile } from "@/api";
import { APP_VERSION } from "@/version";
import { useFeedback } from "@/components/FeedbackProvider";
import Button from "@/components/ui/button";
import { Card, CardContent, } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
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
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="个人中心" subtitle="管理你的账户与偏好" icon={User} />

      {/* ── Profile info ── */}
      <Card>
        <div className="flex items-center gap-4 p-5">
          <img src={avatar} alt="头像"
            className="size-14 shrink-0 rounded-full object-cover ring-2 ring-border bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{storeUser?.display_name || "-"}</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {storeUser?.role_display_name || storeUser?.role || "用户"}
              {storeUser?.username && <> · @{storeUser.username}</>}
            </div>
            {storeUser?.student_id && (
              <div className="text-xs text-muted-foreground mt-0.5">学号: {storeUser.student_id}</div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={openEditDialog}>
            <Pencil size={14} />编辑
          </Button>
        </div>
      </Card>

      {/* ── Actions ── */}
      <Card>
        <CardContent className="p-0">
          <button type="button" onClick={openPasswordDialog}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">修改密码</div>
              <div className="text-xs text-muted-foreground">定期更换密码保护账户安全</div>
            </div>
          </button>
          <div className="border-t border-border" />
          <button type="button" onClick={openFeedback}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">意见反馈</div>
              <div className="text-xs text-muted-foreground">报告问题或提出改进建议</div>
            </div>
          </button>
          <div className="border-t border-border" />
          <button type="button" onClick={() => setThemeOpen(true)}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Palette size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">主题与外观</div>
              <div className="text-xs text-muted-foreground">配色方案与深浅模式</div>
            </div>
          </button>
          <div className="border-t border-border" />
          <button type="button" onClick={() => setAboutOpen(true)}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Info size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">关于系统</div>
              <div className="text-xs text-muted-foreground">版本 {APP_VERSION}</div>
            </div>
          </button>
        </CardContent>
      </Card>

      {/* ── Logout ── */}
      <Card>
        <CardContent className="p-0">
          <button type="button" onClick={() => { logout(); navigate("/login"); }}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted text-destructive">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <LogOut size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">退出登录</div>
              <div className="text-xs opacity-70">安全退出当前账号</div>
            </div>
          </button>
        </CardContent>
      </Card>

      {/* ── Theme dialog ── */}
      <Dialog open={themeOpen} onOpenChange={(o) => { if (!o) setThemeOpen(false); }}>
        <DialogContent title="主题与外观" maxWidth={420}>
          <div className="space-y-5 mt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-3">配色方案</p>
              <PalettePicker />
            </div>
            <div className="pt-3 border-t border-border">
              <ThemeToggleButton />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit profile dialog ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent title="编辑资料" maxWidth={480}>
          <FormMessageBanner type={saveMsg.includes("成功") ? "success" : "error"} message={saveMsg} />
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(handleSave)} className="space-y-4 mt-2">
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
                    <div className="flex gap-2">
                      <Button type="button" variant={field.value === "男" ? "default" : "outline"} size="sm"
                        onClick={() => field.onChange("男")}>男</Button>
                      <Button type="button" variant={field.value === "女" ? "default" : "outline"} size="sm"
                        onClick={() => field.onChange("女")}>女</Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
                <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                  {profileForm.formState.isSubmitting ? <Loader2 size={16} className="animate-spin" /> : "保存"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Password dialog ── */}
      <Dialog open={pwdOpen} onOpenChange={(o) => { if (!o) setPwdOpen(false); }}>
        <DialogContent title="修改密码" maxWidth={480}>
          <FormMessageBanner type={pwdMsg.includes("成功") ? "success" : "error"} message={pwdMsg} />
          <Form {...pwForm}>
            <form onSubmit={pwForm.handleSubmit(handleChangePassword)} className="space-y-3 mt-2">
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
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
                <Button type="submit" disabled={pwForm.formState.isSubmitting}>
                  {pwForm.formState.isSubmitting ? <Loader2 size={16} className="animate-spin" /> : "确认修改"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── About dialog ── */}
      <Dialog open={aboutOpen} onOpenChange={(o) => { if (!o) setAboutOpen(false); }}>
        <DialogContent title="关于系统" maxWidth={420}>
          <div className="space-y-4 py-2 text-center">
            <div className="flex justify-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary shadow-e1">
                <Stethoscope size={24} className="text-primary-foreground" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold">虚拟患者系统</h3>
              <p className="text-sm text-muted-foreground mt-1">护理病史采集技能训练平台</p>
              <p className="mt-3 text-xs text-muted-foreground">版本 {APP_VERSION}</p>
            </div>
            <a
              href="/showcase"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              查看产品介绍 <ExternalLink size={14} />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button type="button" onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{isDark ? "浅色模式" : "深色模式"}</div>
        <div className="text-xs text-muted-foreground">切换界面颜色主题</div>
      </div>
    </button>
  );
}

function PalettePicker() {
  const { id: activeId, themes, setPalette } = usePalette();
  return (
    <div className="flex gap-2 flex-wrap">
      {themes.map((t) => (
        <button key={t.id} type="button" onClick={() => setPalette(t.id)}
          className="flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all hover:border-primary/50 active:scale-95"
          style={{
            borderColor: activeId === t.id ? t.colors.primary : undefined,
            backgroundColor: activeId === t.id ? `${t.colors.accent}80` : undefined,
          }}
          title={t.description}>
          <div className="size-8 rounded-full ring-2 ring-white shadow-e1 flex items-center justify-center transition-transform"
            style={{ backgroundColor: t.colors.primary }}>
            {activeId === t.id && <Check size={14} className="text-white" strokeWidth={3} />}
          </div>
          <span className="text-[10px] font-medium text-muted-foreground">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
