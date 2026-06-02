import type { ElementType, ReactNode } from "react";
import {
  BarChart3,
  ClipboardList,
  GraduationCap,
  HardDrive,
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
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { APP_VERSION } from "../version";
import useAuthStore from "../stores/authStore";
import { useFeedback } from "./FeedbackProvider";
import Modal from "./ui/Modal";

interface NavLinkItem {
  to: string;
  icon: ElementType;
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
  { to: "/admin/backup", icon: HardDrive, label: "备份管理" },
];

export default function AppShell({ children }: { children: ReactNode }) {
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
    <div className="app-shell">
      {mobileMenuOpen && <div className="sidebar-overlay" onClick={closeMenu} />}

      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <h2>虚拟患者系统</h2>
          <span>护理病史采集训练</span>
        </div>

        <nav className="sidebar-nav">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/home" || link.to === "/admin"}
                onClick={closeMenu}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <Icon className="nav-icon" size={16} />
                {link.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="avatar-dot">{(user?.display_name || "U")[0]}</div>
            <div className="info">
              <div className="name">{user?.display_name}</div>
              <div className="role">{isTeacher ? "教师" : "学生"}</div>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <button className="btn-about" onClick={() => setAboutOpen(true)}>
              <Info size={14} />
              关于
            </button>
            <button className="btn-logout" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        </div>

        <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="关于" maxWidth={380}>
          <div className="about-content">
            <h3>虚拟患者系统</h3>
            <p>护理病史采集技能训练平台</p>
            <p className="about-version">版本 {APP_VERSION}</p>
            <button className="btn btn-outline" onClick={handleOpenFeedback} style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>
              <MessageSquare size={14} />
              意见反馈
            </button>
          </div>
        </Modal>
      </aside>

      <main className="main-content">
        <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen((v) => !v)} aria-label={mobileMenuOpen ? "关闭菜单" : "打开菜单"}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {children}
      </main>
    </div>
  );
}
