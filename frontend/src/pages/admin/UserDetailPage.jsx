import { Activity, Clock, FileText, Medal, Target, TrendingUp, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getStudentDetail } from "../../api";
import Layout from "../../components/Layout";
import { useToast } from "../../components/Toast";
import PageHeader from "../../components/ui/PageHeader";

export default function UserDetailPage({ user, onLogout }) {
  const { userId } = useParams();
  const [data, setData] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    getStudentDetail(Number(userId))
      .then(({ data: d }) => setData(d))
      .catch(() => toast.error("加载学生详情失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!data) {
    return (
      <Layout user={user} onLogout={onLogout}>
        <div className="empty-state" style={{ padding: "48px 0" }}>
          加载中...
        </div>
      </Layout>
    );
  }

  const daily = data.daily || [];
  const hasChartData = daily.length > 0;
  const formatDate = (d) => new Date(d.created_at).toLocaleDateString("zh-CN");

  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader
        title={data.display_name}
        subtitle={`学生详情 · 学号: ${data.student_id || "-"} · 注册: ${formatDate(data)}`}
        icon={UserIcon}
        backTo="/admin/users"
      />

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Activity size={22} />
          </div>
          <div>
            <div className="stat-value">{data.total_sessions}</div>
            <div className="stat-label">总训练次数</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber">
            <Clock size={22} />
          </div>
          <div>
            <div className="stat-value">{data.total_minutes}</div>
            <div className="stat-label">总训练时长（分钟）</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <Target size={22} />
          </div>
          <div>
            <div className="stat-value">{data.avg_score != null ? `${data.avg_score}分` : "-"}</div>
            <div className="stat-label">平均得分</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan">
            <Medal size={22} />
          </div>
          <div>
            <div className="stat-value">{data.total_sessions > 0 ? `${Math.round(data.total_minutes / data.total_sessions)}分钟` : "-"}</div>
            <div className="stat-label">平均每次训练时长</div>
          </div>
        </div>
      </div>

      {hasChartData && (
        <div className="chart-container" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={18} /> 近30天训练趋势
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: "次数", position: "insideLeft", offset: -5, style: { fontSize: 12 } }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                label={{ value: "得分", position: "insideRight", offset: -5, style: { fontSize: 12 } }}
                domain={[0, 100]}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="sessions" name="训练次数" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={28} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avg_score"
                name="平均得分"
                stroke="#22c55e"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#22c55e" }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>
            <FileText size={18} /> 最近训练记录 ({data.recent_records.length}条)
          </h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>病例</th>
              <th>状态</th>
              <th>得分</th>
              <th>开始时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_records.map((r) => (
              <tr key={r.id}>
                <td>{r.case_name}</td>
                <td>
                  <span className={`badge ${r.status === "completed" ? "badge-success" : "badge-info"}`}>{r.status === "completed" ? "已完成" : "进行中"}</span>
                </td>
                <td style={{ fontWeight: 600, color: r.score_total != null ? "var(--primary)" : "var(--text-secondary)" }}>
                  {r.score_total != null ? `${r.score_total}分` : "未评分"}
                </td>
                <td style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{new Date(r.start_time).toLocaleString("zh-CN")}</td>
                <td>
                  <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/record/${r.id}`)}>
                    查看详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontSize: "0.82rem" }}>
          {p.name}:{" "}
          <strong>
            {p.value}
            {p.name.includes("得分") ? "分" : "次"}
          </strong>
        </div>
      ))}
    </div>
  );
}
