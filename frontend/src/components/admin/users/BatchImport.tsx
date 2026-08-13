import {
  IconAlertCircle,
  IconDownload,
  IconFileText,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { Alert, Box, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RoleBadge } from "@/components/ui/role-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BatchUser, RoleOption } from "./types";

const CSV_HEADERS = ["用户名", "密码", "姓名", "角色", "学号", "班级名称"];
const BOM = "\uFEFF";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

interface BatchImportProps {
  open: boolean;
  onClose: () => void;
  roles: RoleOption[];
  isImporting: boolean;
  onImport: (users: BatchUser[]) => void;
}

export default function BatchImport({ open, onClose, roles, isImporting, onImport }: BatchImportProps) {
  const [batchText, setBatchText] = useState("");
  const [batchPreview, setBatchPreview] = useState<BatchUser[]>([]);
  const [batchParseError, setBatchParseError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setBatchText("");
    setBatchPreview([]);
    setBatchParseError("");
  }

  function handleClose() {
    if (isImporting) return;
    resetState();
    onClose();
  }

  function parseLines(lines: string[]) {
    setBatchParseError("");
    setBatchPreview([]);

    if (lines.length === 0) return;

    // Detect header row
    const firstParts = parseCSVLine(lines[0]).map((s) => s.replace(BOM, ""));
    const isHeader = CSV_HEADERS.some((h) => firstParts.includes(h));
    const dataRows = isHeader ? lines.slice(1) : lines;

    const errors: string[] = [];
    const users: BatchUser[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row.trim()) continue;

      const parts = parseCSVLine(row);

      let username = "", password = "", displayName = "", role = "student", studentId: string | null = null, className: string | null = null, _classId: number | null = null;
      if (isHeader) {
        const colIdx = (h: string) => firstParts.indexOf(h);
        username = parts[colIdx("用户名")] || "";
        password = parts[colIdx("密码")] || "";
        displayName = parts[colIdx("姓名")] || "";
        role = parts[colIdx("角色")] || "student";
        studentId = parts[colIdx("学号")] || null;
        className = parts[colIdx("班级名称")] || null;
      } else {
        username = parts[0] || "";
        password = parts[1] || "";
        displayName = parts[2] || "";
        role = parts[3] || "student";
        studentId = parts[4] || null;
        className = parts[5] || null;
      }

      const locator = isHeader ? `第${i+1}行` : `第${i+1}行(${username || "?"})`;
      if (!username || !password || !displayName) { errors.push(`${locator}: 用户名/密码/姓名不能为空`); continue; }
      if (password.length < 6) { errors.push(`${locator}: 密码长度不能少于6位`); continue; }
      if (role !== "student") { errors.push(`${locator}: 仅支持学生角色（当前: ${role}）`); continue; }

      users.push({ username, password, display_name: displayName, role: "student", student_id: studentId, class_name: className, class_id: null });
    }

    if (errors.length > 0) {
      setBatchParseError(errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n... 还有 ${errors.length - 10} 个错误` : ""));
    }
    if (users.length > 0) setBatchPreview(users);
  }

  function parseBatchText(text: string) {
    const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    parseLines(lines);
  }

  function parseCSVFile(file: File) {
    setBatchParseError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      if (!(e.target?.result instanceof ArrayBuffer)) return;
      const arr = new Uint8Array(e.target.result);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(arr);
      } catch {
        text = new TextDecoder("gbk").decode(arr);
      }
      text = text.replace(/^\uFEFF/, "");
      const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      parseLines(lines);
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDownloadTemplate() {
    const csvContent = BOM + CSV_HEADERS.join(",") + "\n" +
      "student01,123456,张同学,student,S2024001,护理1班\n" +
      "student02,myp@ss,李同学,student,S2024002,护理1班\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "学生导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    if (batchPreview.length === 0) return;
    onImport(batchPreview);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent title={<><IconUsers size={20} /> 批量导入学生</>} maxWidth={650}>
        <Text size="xs" c="dimmed" mb="md">
          支持 CSV 文件上传或直接粘贴文本。表头行自动识别，无表头按位置匹配。
          仅限创建<strong>学生</strong>角色账号，班级名称不存在时自动创建。
        </Text>
        <Box mb="md">
          <Group gap={6} mb={8}>
            <IconFileText size={14} />
            <Text fw={600} size="sm">粘贴文本（每行一个学生，逗号分隔）</Text>
          </Group>
          <Textarea
            rows={5}
            placeholder={`${CSV_HEADERS.join(",")}\nstudent01,123456,张同学,student,S2024001,护理1班`}
            value={batchText}
            onChange={(e) => { setBatchText(e.currentTarget.value); parseBatchText(e.currentTarget.value); }}
            disabled={isImporting}
            style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
          />
          <Text size="xs" c="dimmed" mt={4}>
            列顺序：{CSV_HEADERS.join(" / ")}（班级名称可选）
          </Text>
        </Box>
        <Group gap={12} mb="md" wrap="wrap">
          <Button
            variant="secondary"
            size="sm"
            leftSection={<IconUpload size={14} />}
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            上传 CSV 文件
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setBatchText(""); parseCSVFile(f); } e.target.value = ""; }}
            hidden
            disabled={isImporting}
          />
          <Button
            variant="link"
            size="sm"
            leftSection={<IconDownload size={14} />}
            onClick={handleDownloadTemplate}
          >
            下载模板
          </Button>
        </Group>
        {batchParseError && (
          <Alert color="red" variant="light" mb="md" style={{ maxHeight: 128, overflowY: "auto" }}>
            <Stack gap={4}>
              {batchParseError.split("\n").map((e, i) => (
                <Group key={i} gap={6} align="flex-start" wrap="nowrap">
                  <IconAlertCircle size={13} style={{ flexShrink: 0, marginTop: 3 }} />
                  <Text size="xs">{e}</Text>
                </Group>
              ))}
            </Stack>
          </Alert>
        )}
        {batchPreview.length > 0 && (
          <Box mb="md">
            <Text fw={600} size="sm" mb="xs">预览（{batchPreview.length} 名学生）</Text>
            <ScrollArea h={200}>
              <Table stickyHeader>
                <TableHeader>
                  <TableRow>
                    {CSV_HEADERS.map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchPreview.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell>{u.username}</TableCell>
                      <TableCell>{"*".repeat(Math.min(u.password.length, 8))}</TableCell>
                      <TableCell>{u.display_name}</TableCell>
                      <TableCell><RoleBadge role={u.role} label={roles.find((r) => r.name === u.role)?.display_name || u.role} /></TableCell>
                      <TableCell><Text size="sm" c="dimmed">{u.student_id || "-"}</Text></TableCell>
                      <TableCell><Text size="sm" c="dimmed">{u.class_name || u.class_id || "-"}</Text></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Box>
        )}
        <Group gap={12} justify="flex-end">
          <Button variant="outline" onClick={handleClose} disabled={isImporting}>取消</Button>
          <Button
            disabled={batchPreview.length === 0 || isImporting}
            onClick={handleImport}
          >
            {isImporting ? "导入中..." : `导入 ${batchPreview.length} 名学生`}
          </Button>
        </Group>
      </DialogContent>
    </Dialog>
  );
}
