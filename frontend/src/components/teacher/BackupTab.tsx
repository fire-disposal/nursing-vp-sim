import { Database, DownloadCloud } from "lucide-react";
import { useState } from "react";
import { downloadBackup } from "@/api/api-client";
import { useToast } from "../Toast";

export default function BackupTab() {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await downloadBackup();

      const contentDisposition = response.headers["content-disposition"];
      let filename = "backup.zip";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (match) filename = match[1];
      }

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success("备份下载成功");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail || (err as { message?: string }).message || "未知错误";
      toast.error(`备份下载失败: ${msg}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="card">
      <div className="empty-state" style={{ padding: "var(--space-12) 0" }}>
        <div className="icon">
          <Database size={48} />
        </div>
        <div style={{ fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-semibold)", marginTop: "var(--space-3)" }}>下载数据库备�?/div>
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginTop: "var(--space-1)", maxWidth: 380, lineHeight: 1.5 }}>
          使用 pg_dump 导出完整数据库，生成 .zip 压缩包下载到本地。可用于数据安全备份或迁移�?
        </div>
        <button
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={downloading}
          style={{ marginTop: "var(--space-4)", display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}
        >
          {downloading ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              正在导出备份...
            </>
          ) : (
            <>
              <DownloadCloud size={16} />
              下载数据库备�?
            </>
          )}
        </button>
      </div>
    </div>
  );
}
