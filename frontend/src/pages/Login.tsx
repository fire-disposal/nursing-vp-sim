import { Activity, Stethoscope } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
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
      console.error("[Login] 登录失败:", err);
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(axiosErr.response?.data?.detail || axiosErr.message || "登录失败，请检查账号密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-teal-50">
      <div className="relative w-[420px] max-w-[92vw] overflow-hidden rounded-2xl border border-border/50 bg-white shadow-xl">
        <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-8">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/20 shadow-inner">
            <Stethoscope size={30} className="text-white" />
          </div>
        </div>

        <div className="space-y-5 px-8 pb-8 pt-6">
          <div className="text-center">
            <h2 className="text-xl font-bold tracking-tight text-foreground">虚拟患者训练系统</h2>
            <p className="mt-1 text-sm text-muted-foreground">护理病史采集技能训练平台</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              <Activity size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
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
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full font-semibold">
              {loading ? "登录中..." : "登 录"}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">请输入您的账号和密码登录系统</p>
        </div>
      </div>
    </div>
  );
}
