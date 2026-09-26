import {
  IconAlertCircle,
  IconDownload,
  IconFileText,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { Alert, Box, Button, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";

import { RoleBadge } from "@/components/ui/role-badge";
import { Textarea } from "@mantine/core";
import { Table } from "@mantine/core";
import type { ClassItem } from "@/types/store";
import type { BatchUser, RoleOption } from "./types";

const CSV_HEADERS = ["用户名", "密码", "姓名", "角色", "学号", "届别", "班级名称"];
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
  /** 全部班级，用于把「届别 + 班级名」解析成确定的 class_id。 */
  classes: ClassItem[];
  isImporting: boolean;
  onImport: (users: BatchUser[]) => void;
}

export default function BatchImport({ open, onClose, roles, classes, isImporting, onImport }: BatchImportProps) {
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

  /**
   * 解析一行的班级归属。返回 `class_id`（已存在）或待创建班级的 `(cohort, name)`。
   * 同名班级跨届别而该行未给出届别时报错——绝不静默挑一条。
   */
  function resolveClass(
    className: string,
    cohortLabel: string,
  ): { classId: number | null; error?: string } {
    const matches = classes.filter((c) => c.name === className);
    if (cohortLabel) {
      const exact = matches.find((c) => c.cohort_label === cohortLabel);
      return { classId: exact ? exact.id : null };
    }
    const distinct = [...new Set(matches.map((c) => c.cohort_label))];
    if (distinct.length > 1) {
      return {
        classId: null,
        error: `班级名称「${className}」存在于多个届别（${distinct.join("、")}），请补充「届别」列`,
      };
    }
    return { classId: matches[0]?.id ?? null };
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

      let username = "", password = "", displayName = "", role = "student", studentId: string | null = null;
      let className: string = "", cohortLabel = "";
      if (isHeader) {
        const colIdx = (h: string) => firstParts.indexOf(h);
        username = parts[colIdx("用户名")] || "";
        password = parts[colIdx("密码")] || "";
        displayName = parts[colIdx("姓名")] || "";
        role = parts[colIdx("角色")] || "student";
        studentId = parts[colIdx("学号")] || null;
        cohortLabel = parts[colIdx("届别")] || "";
        className = parts[colIdx("班级名称")] || "";
      } else {
        username = parts[0] || "";
        password = parts[1] || "";
        displayName = parts[2] || "";
        role = parts[3] || "student";
        studentId = parts[4] || null;
        cohortLabel = parts[5] || "";
        className = parts[6] || "";
      }

      // 有表头时数据从第 2 行开始，行号与用户在 CSV 里看到的一致。
      const rowNo = isHeader ? i + 2 : i + 1;
      const locator = `第${rowNo}行(${username || "?"})`;
      if (!username || !password || !displayName) { errors.push(`${locator}: 用户名/密码/姓名不能为空`); continue; }
      if (password.length < 6) { errors.push(`${locator}: 密码长度不能少于6位`); continue; }
      if (role !== "student") { errors.push(`${locator}: 仅支持学生角色（当前: ${role}）`); continue; }

      let classId: number | null = null;
      if (className) {
        const resolved = resolveClass(className, cohortLabel);
        if (resolved.error) { errors.push(`${locator}: ${resolved.error}`); continue; }
        classId = resolved.classId;
      }

      users.push({
        username,
        password,
        display_name: displayName,
        role: "student",
        student_id: studentId,
        class_name: className || null,
        cohort_label: cohortLabel || null,
        class_id: classId,
      });
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
      "student01,123456,张同学,student,S2024001,2024级,护理1班\n" +
      "student02,myp@ss,李同学,student,S2024002,2024级,护理1班\n";
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

  function classCell(u: BatchUser) {
    if (!u.class_name) return "-";
    const label = u.cohort_label ? `${u.cohort_label} ${u.class_name}` : u.class_name;
    return u.class_id != null ? label : `${label}（将新建）`;
  }

  return (
    <Modal
      opened={open}
      onClose={handleClose}
      title={<><IconUsers size={20} /> 批量导入学生</>}
      size={720}
      centered
      withinPortal
    >
        <Text size="xs" c="dimmed" mb="md">
          支持 CSV 文件上传或直接粘贴文本。表头行自动识别，无表头按位置匹配。
          仅限创建<strong>学生</strong>角色账号；班级不存在时自动创建。
          同名班级存在于多个届别时，必须填写「届别」列消歧，否则该行报错丢弃。
        </Text>
        <Box mb="md">
          <Group gap={6} mb={8}>
            <IconFileText size={14} />
            <Text fw={600} size="sm">粘贴文本（每行一个学生，逗号分隔）</Text>
          </Group>
          <Textarea
            rows={5}
            placeholder={`${CSV_HEADERS.join(",")}\nstudent01,123456,张同学,student,S2024001,2024级,护理1班`}
            value={batchText}
            onChange={(e) => { setBatchText(e.currentTarget.value); parseBatchText(e.currentTarget.value); }}
            disabled={isImporting}
            style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
          />
          <Text size="xs" c="dimmed" mt={4}>
            列顺序：{CSV_HEADERS.join(" / ")}（届别与班级名称可选）
          </Text>
        </Box>
        <Group gap={12} mb="md" wrap="wrap">
          <Button
            variant="light"
            color="gray"
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
            variant="transparent"
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
                <Table.Thead>
                  <Table.Tr>
                    {CSV_HEADERS.map((h) => (
                      <Table.Th key={h}>{h}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {batchPreview.map((u, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{u.username}</Table.Td>
                      <Table.Td>{"*".repeat(Math.min(u.password.length, 8))}</Table.Td>
                      <Table.Td>{u.display_name}</Table.Td>
                      <Table.Td><RoleBadge role={u.role} label={roles.find((r) => r.name === u.role)?.display_name || u.role} /></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{u.student_id || "-"}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{u.cohort_label || "-"}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{classCell(u)}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
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
    </Modal>
  );
}
