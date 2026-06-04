import { Activity, Stethoscope } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import LoginIllustration from "@/components/LoginIllustration";
import useAuthStore from "@/stores/authStore";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/home");
    } catch (err: unknown) {
      console.error("[Login] failed:", err);
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(axiosErr.response?.data?.detail || axiosErr.message || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/30 to-sky-50">
      <div className="absolute inset-0 bg-grid-medical animate-rotate-slow" />

      <div className="absolute size-72 rounded-full bg-blue-400/15 blur-3xl animate-float" style={{ left: "10%", top: "20%" }} />
      <div className="absolute size-96 rounded-full bg-teal-400/10 blur-3xl animate-float-delayed" style={{ right: "15%", bottom: "15%" }} />
      <div className="absolute size-60 rounded-full bg-blue-300/10 blur-3xl animate-breathe" style={{ left: "50%", top: "10%" }} />
      <div className="absolute size-48 rounded-full bg-sky-300/12 blur-2xl animate-float" style={{ left: "25%", bottom: "25%" }} />
      <div className="absolute size-40 rounded-full bg-indigo-300/8 blur-2xl animate-float-delayed" style={{ right: "30%", top: "40%" }} />

      <div className="relative z-10 flex w-full max-w-5xl items-center gap-8 px-6 py-10">
        <LoginIllustration />

        <div className="w-full lg:w-1/2 flex flex-col items-center lg:items-start">
          <div className="mb-8 text-center lg:text-left">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25 lg:mx-0">
              <Stethoscope size={32} className="text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">虚拟患者系统</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">护理病史采集技能训练平台</p>
          </div>

          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                <Activity size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
                autoComplete="username"
                required
                autoFocus
                className="h-11"
              />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                autoComplete="current-password"
                required
                className="h-11"
              />
              <Button type="submit" disabled={loading} className="h-11 w-full">
                {loading ? "登录中..." : "登 录"}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground lg:text-left lg:pl-0">虚拟患者 · 护理教学平台</p>
        </div>
      </div>
    </div>
  );
}
