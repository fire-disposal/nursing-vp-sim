import {
  BarChart3,
  Building2,
  Check,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  Globe,
  GraduationCap,
  HelpCircle,
  Home,
  Info,
  Key,
  LogOut,
  Menu,
  MessageSquare,
  Server,
  Settings,
  Shield,
  Stethoscope,
  UserSearch,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { changePassword } from "@/api/api-client";
import { api } from "@/api/axios-instance";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import useAuthStore from "../stores/authStore";
import useSchoolStore from "../stores/schoolStore";
import { APP_VERSION } from "../version";
import { useFeedback } from "./FeedbackProvider";
import Modal from "./ui/Modal";

interface NavLinkItem {
  to: string;
  icon: typeof Home;
  label: string;
  permission?: string;
}

const allLinks: NavLinkItem[] = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/cases", icon: Stethoscope, label: "病例训练", permission: "training_access" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
  { to: "/admin/users", icon: Users, label: "用户管理", permission: "user_manage" },
  { to: "/admin/roles", icon: Shield, label: "角色管理", permission: "role_manage" },
  { to: "/admin/schools", icon: Building2, label: "学校管理", permission: "school_manage" },
  { to: "/admin/grades-classes", icon: GraduationCap, label: "班级管理", permission: "grade_class_manage" },
  { to: "/admin/cases", icon: UserSearch, label: "病例管理", permission: "case_manage" },
  { to: "/admin", icon: Settings, label: "训练管理", permission: "score_review" },
  { to: "/admin/llm", icon: Server, label: "LLM 管理", permission: "llm_monitor" },
  { to: "/admin/feedback", icon: MessageSquare, label: "用户反馈", permission: "feedback_review" },
  { to: "/admin/questionnaires", icon: ClipboardCheck, label: "问卷管理", permission: "questionnaire_manage" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const logout = useAuthStore((s) => s.logout);
  const { selectedSchoolId, setSelectedSchool, isSuperAdmin } = useSchoolStore();

  const links = useMemo(() => {
    return allLinks.filter((link) => !link.permission || permissions.includes(link.permission));
  }, [permissions]);
  const userLinks = links.filter((l) => !l.to.startsWith("/admin"));
  const adminLinks = links.filter((l) => l.to.startsWith("/admin"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [schoolSelectorOpen, setSchoolSelectorOpen] = useState(false);
  const [schools, setSchools] = useState<{ id: number; name: string }[]>([]);
  const { openFeedback } = useFeedback();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);

  const isAdmin = isSuperAdmin();

  useEffect(() => {
    if (isAdmin) {
      api.get("/admin/schools", { params: { limit: 200 } }).then((r) => {
        setSchools(r.data.items || []);
      });
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin && user?.school_id) {
      setSelectedSchool(user.school_id);
    }
  }, [isAdmin, user?.school_id, setSelectedSchool]);

  const currentSchoolName = isAdmin
    ? selectedSchoolId == null
      ? "全局视角"
      : schools.find((s) => s.id === selectedSchoolId)?.name || "选择学校"
    : user?.school_name || "";

  const close = () => setMobileOpen(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleChangePassword = async () => {
    setPwdMsg("");
    if (!oldPassword || !newPassword) {
      setPwdMsg("请填写完整");
      return;
    }
    if (newPassword.length < 6) {
      setPwdMsg("新密码至少 6 个字符");
      return;
    }
    setPwdLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setPwdMsg("密码修改成功");
      setTimeout(() => {
        setPasswordOpen(false);
        setOldPassword("");
        setNewPassword("");
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
    <div className="flex min-h-screen">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={close} role="presentation" />}

      <aside
        aria-label="主导航"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-300 ease-out md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <Stethoscope size={16} className="text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">虚拟患者系统</div>
            <div className="text-xs text-muted-foreground">护理训练平台</div>
          </div>
        </div>

        {currentSchoolName && (
          <>
            <Separator />
            <div className="px-3 py-2">
              {isAdmin ? (
                <div className="relative">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    onClick={() => setSchoolSelectorOpen((v) => !v)}
                    aria-label="切换学校"
                  >
                    <Building2 size={13} />
                    <span className="truncate flex-1 text-left">{currentSchoolName}</span>
                    <ChevronsUpDown size={12} />
                  </button>
                  {schoolSelectorOpen && (
                    <div className="absolute left-0 top-full mt-1 z-[60] w-48 rounded-lg border border-border bg-card shadow-lg py-1">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                          selectedSchoolId == null && "bg-primary/10 text-primary font-semibold",
                        )}
                        onClick={() => {
                          setSelectedSchool(null);
                          setSchoolSelectorOpen(false);
                        }}
                      >
                        <Globe size={13} />
                        全局视角
                        {selectedSchoolId == null && <Check size={13} className="ml-auto" />}
                      </button>
                      <Separator className="my-0.5" />
                      {schools.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                            selectedSchoolId === s.id && "bg-primary/10 text-primary font-semibold",
                          )}
                          onClick={() => {
                            setSelectedSchool(s.id);
                            setSchoolSelectorOpen(false);
                          }}
                        >
                          <Building2 size={13} />
                          <span className="truncate">{s.name}</span>
                          {selectedSchoolId === s.id && <Check size={13} className="ml-auto" />}
                        </button>
                      ))}
                    </div>
                  )}
                  {schoolSelectorOpen && <div className="fixed inset-0 z-[59]" onClick={() => setSchoolSelectorOpen(false)} />}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                  <Building2 size={13} />
                  <span className="truncate">{currentSchoolName}</span>
                </div>
              )}
            </div>
          </>
        )}

        {!currentSchoolName && <Separator />}

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {userLinks.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/home"}
                onClick={close}
                className={({ isActive }) =>
                  cn(
                    "mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-primary/10 text-primary",
                  )
                }
              >
                <Icon size={17} />
                {link.label}
              </NavLink>
            );
          })}
          {adminLinks.length > 0 && (
            <>
              <Separator className="my-2" />
              <div className="px-3 py-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">管理</p>
              </div>
              {adminLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === "/admin"}
                    onClick={close}
                    className={({ isActive }) =>
                      cn(
                        "mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
                        isActive && "bg-primary/10 text-primary",
                      )
                    }
                  >
                    <Icon size={17} />
                    {link.label}
                  </NavLink>
                );
              })}
            </>
          )}
        </nav>

        <Separator />

        <div className="p-3">
          <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {(user?.display_name || "U")[0]}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user?.display_name}</div>
              <div className="text-xs text-muted-foreground">{user?.role_display_name || user?.role || "用户"}</div>
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setPasswordOpen(true)}>
              <Key size={13} />
              密码
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAboutOpen(true)}>
              <Info size={13} />
              关于
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={handleLogout}>
              <LogOut size={13} />
              退出
            </Button>
          </div>
        </div>

        <Modal open={passwordOpen} onClose={() => setPasswordOpen(false)} title="修改密码">
          <div className="space-y-3 py-2">
            {pwdMsg && (
              <div
                className={cn("px-3 py-2 rounded-lg text-sm", pwdMsg.includes("成功") ? "bg-green-50 text-green-600" : "bg-destructive/10 text-destructive")}
              >
                {pwdMsg}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">原密码</label>
              <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="输入原密码" className="h-10" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">新密码</label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 个字符" className="h-10" />
            </div>
            <Button className="w-full" onClick={handleChangePassword} disabled={pwdLoading}>
              {pwdLoading ? "修改中..." : "确认修改"}
            </Button>
          </div>
        </Modal>

        <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="关于系统">
          <div className="space-y-3 py-2 text-center">
            <div className="flex justify-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary shadow">
                <Stethoscope size={24} className="text-primary-foreground" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold">虚拟患者系统</h3>
              <p className="text-sm text-muted-foreground">护理病史采集技能训练平台</p>
              <p className="mt-2 text-xs text-muted-foreground">版本 {APP_VERSION}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setAboutOpen(false);
                openFeedback();
              }}
            >
              <MessageSquare size={14} />
              意见反馈
            </Button>
          </div>
        </Modal>
      </aside>

      <main className="flex-1 md:ml-60" style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}>
        <div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-accent"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold">虚拟患者系统</span>
            {currentSchoolName && <span className="ml-2 text-xs text-muted-foreground">· {currentSchoolName}</span>}
          </div>
        </div>
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
