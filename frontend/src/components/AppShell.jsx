import { BarChart3, ClipboardList, HelpCircle, Home, Info, Menu, MessageSquare, Settings, Stethoscope, X } from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { APP_VERSION } from "../version";
import { useFeedback } from "./FeedbackProvider";
import Modal from "./ui/Modal";

const studentLinks = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/cases", icon: Stethoscope, label: "病例训练" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
];

const teacherLinks = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
  { to: "/admin", icon: Settings, label: "管理后台" },
];

export default function AppShell({ children, user, onLogout }) {
  const navigate = useNavigate();
  const isTeacher = user?.role === "teacher";
  const links = isTeacher ? teacherLinks : studentLinks;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { openFeedback } = useFeedback();

  const closeMenu = () => setMobileMenuOpen(false);

  const handleLogout = () => {
    onLogout();
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
                end={link.to === "/home"}
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
            <button className="btn-feedback" onClick={openFeedback}>
              <MessageSquare size={14} />
              意见反馈
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
