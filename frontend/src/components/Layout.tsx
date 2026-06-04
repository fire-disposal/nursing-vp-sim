import {
  BarChart3,
  ClipboardList,
  GraduationCap,
  HelpCircle,
  Home,
  Info,
  LogOut,
  Menu,
  MessageSquare,
  Server,
  Settings,
  Stethoscope,
  UserSearch,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import useAuthStore from "../stores/authStore";
import { APP_VERSION } from "../version";
import { useFeedback } from "./FeedbackProvider";
import Modal from "./ui/Modal";

interface NavLinkItem {
  to: string;
  icon: typeof Home;
  label: string;
}

const studentLinks: NavLinkItem[] = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/cases", icon: Stethoscope, label: "病例训练" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
];

const teacherLinks: NavLinkItem[] = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
  { to: "/admin", icon: Settings, label: "训练管理" },
  { to: "/admin/users", icon: Users, label: "用户管理" },
  { to: "/admin/grades-classes", icon: GraduationCap, label: "班级管理" },
  { to: "/admin/cases", icon: UserSearch, label: "病例管理" },
  { to: "/admin/llm", icon: Server, label: "LLM 管理" },
  { to: "/admin/feedback", icon: MessageSquare, label: "用户反馈" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isTeacher = user?.role === "teacher";
  const links = isTeacher ? teacherLinks : studentLinks;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { openFeedback } = useFeedback();

  const close = () => setMobileOpen(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={close} />}

      <aside
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

        <Separator />

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/home" || link.to === "/admin"}
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
        </nav>

        <Separator />

        <div className="p-3">
          <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {(user?.display_name || "U")[0]}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user?.display_name}</div>
              <div className="text-xs text-muted-foreground">{isTeacher ? "教师" : "学生"}</div>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs" onClick={() => setAboutOpen(true)}>
              <Info size={13} />
              关于
            </Button>
            <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs text-destructive hover:text-destructive" onClick={handleLogout}>
              <LogOut size={13} />
              退出
            </Button>
          </div>
        </div>

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
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="text-sm font-semibold">虚拟患者系统</span>
        </div>
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
