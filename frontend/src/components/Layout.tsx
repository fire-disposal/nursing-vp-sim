import {
  BarChart3,
  ClipboardList,
  GraduationCap,
  HelpCircle,
  Home,
  Info,
  Menu,
  MessageSquare,
  Server,
  Settings,
  Stethoscope,
  UserSearch,
  Users,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import useAuthStore from "../stores/authStore";
import { APP_VERSION } from "../version";
import { useFeedback } from "./FeedbackProvider";
import Modal from "./ui/Modal";
import { cn } from "@/lib/utils";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { openFeedback } = useFeedback();

  const closeMenu = () => setMobileMenuOpen(false);

  const handleOpenFeedback = () => {
    setAboutOpen(false);
    openFeedback();
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen">
      {mobileMenuOpen && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={closeMenu} />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[200px] flex-col bg-gray-800 text-gray-300 transition-transform duration-300 ease-out md:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-4 pb-3.5 pt-6">
          <h2 className="text-base font-bold text-white">虚拟患者系统</h2>
          <span className="mt-0.5 block text-xs text-gray-400">护理病史采集训练</span>
        </div>

        <nav className="flex flex-1 flex-col gap-px px-2 py-1.5">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/home" || link.to === "/admin"}
                onClick={closeMenu}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-gray-300 no-underline transition-colors hover:bg-white/5 hover:text-white",
                    isActive && "bg-primary text-white hover:bg-primary",
                  )
                }
              >
                <Icon size={16} />
                {link.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/5 px-3.5 py-3">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="flex size-[30px] items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
              {(user?.display_name || "U")[0]}
            </div>
            <div>
              <div className="text-sm font-medium text-white">{user?.display_name}</div>
              <div className="text-xs text-gray-400">{isTeacher ? "教师" : "学生"}</div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-white/10 hover:text-white"
              onClick={() => setAboutOpen(true)}
            >
              <Info size={14} />
              关于
            </button>
            <button
              type="button"
              className="flex flex-1 cursor-pointer items-center rounded-md bg-white/5 px-3 py-1.5 text-xs text-gray-400 hover:bg-red-500/15 hover:text-red-300"
              onClick={handleLogout}
            >
              退出登录
            </button>
          </div>
        </div>

        <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="关于" maxWidth={380}>
          <div className="space-y-2 py-2 text-center">
            <h3 className="text-lg font-semibold">虚拟患者系统</h3>
            <p className="text-sm text-muted-foreground">护理病史采集技能训练平台</p>
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">版本 {APP_VERSION}</p>
            <button
              type="button"
              className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-muted"
              onClick={handleOpenFeedback}
            >
              <MessageSquare size={14} />
              意见反馈
            </button>
          </div>
        </Modal>
      </aside>

      <main className="ml-0 min-h-screen flex-1 p-8 md:ml-[200px]">
        <button
          type="button"
          className="mb-4 cursor-pointer rounded-lg border border-border bg-white p-2 text-gray-500 hover:bg-gray-50 md:hidden"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label={mobileMenuOpen ? "关闭菜单" : "打开菜单"}
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {children}
      </main>
    </div>
  );
}
