import {
  IconAlertCircle,
  IconCircleCheck,
  IconDownload,
  IconFileText,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { Alert, Box, Button, Group, Modal, Stack, Text } from "@mantine/core";

import { RoleBadge } from "@/components/ui/role-badge";
import TableScroll from "@/components/ui/table-scroll";
import { Textarea } from "@mantine/core";
import { Table } from "@mantine/core";
import type { ClassItem } from "@/types/store";
import { getApiErrorDetail } from "@/utils/error";
import type { BatchCreateResult, BatchPreviewResult, BatchUser, RoleOption } from "./types";

const CSV_HEADERS = ["用户名", "密码", "姓名", "角色", "学号", "学校", "届别", "班级名称"];
const BOM = "\uFEFF";

/** 预览行带 CSV 行号：后端只见到过滤后的数组，行号由前端负责对回文件。 */
interface PreviewRow {
  line: number;
  user: BatchUser;
}

interface RowIssue {
  line: number;
  message: string;
}

/** 导入回执：新建/并入/跳过 + 每条被丢行的 CSV 行号与原因。 */
interface ImportReceipt {
  created: number;
  linked: number;
  skipped: number;
  submitted: number;
  notSubmitted: number;
  rows: RowIssue[];
}

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

/** 拆行：BOM 只可能在文件首字节；CRLF / 裸 CR 都当换行。 */
function splitRecords(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
}

interface BatchImportProps {
  open: boolean;
  onClose: () => void;
  roles: RoleOption[];
  /** 全部班级，用于把「届别 + 班级名」解析成确定的 class_id。 */
  classes: ClassItem[];
  /** 提交一批学生；返回后端的逐行回执（新建/并入/跳过的行与原因）。 */
  onImport: (users: BatchUser[]) => Promise<BatchCreateResult>;
  /** 预检：只读，返回每行将被「新建 / 并入既有账号 / 跳过（原因）」。 */
  onPreview: (users: BatchUser[]) => Promise<BatchPreviewResult>;
}

export default function BatchImport({ open, onClose, roles, classes, onImport, onPreview }: BatchImportProps) {
  const [batchText, setBatchText] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [plan, setPlan] = useState<BatchPreviewResult | null>(null);
  const [parseIssues, setParseIssues] = useState<RowIssue[]>([]);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [importError, setImportError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setBatchText("");
    setPreviewRows([]);
    setPlan(null);
    setParseIssues([]);
    setReceipt(null);
    setImportError("");
  }

  function handleClose() {
    if (submitting) return;
    resetState();
    onClose();
  }

  /**
   * 解析一行的班级归属。返回 `class_id`（已存在）或 null（交给后端在「学校」下新建）。
   *
   * 班级名只在**院校内**唯一：给出「学校」时只在该校里找；没给学校却命中多个院校/
   * 多个届别时报错——绝不静默挑一条（挑错就是把学生挂到别的院校的班里）。
   */
  function resolveClass(
    className: string,
    cohortLabel: string,
    schoolName: string,
  ): { classId: number | null; error?: string } {
    const matches = classes.filter(
      (c) => c.name === className && (!schoolName || c.school_name === schoolName),
    );
    const schools = [...new Set(matches.map((c) => c.school_name).filter(Boolean))];
    if (schools.length > 1) {
      return {
        classId: null,
        error: `班级名称「${className}」存在于多个院校（${schools.join("、")}），请补充「学校」列`,
      };
    }
    if (cohortLabel) {
      const exact = matches.find((c) => c.cohort_label === cohortLabel);
      return { classId: exact ? exact.id : null };
    }
    const cohorts = [...new Set(matches.map((c) => c.cohort_label).filter(Boolean))];
    if (cohorts.length > 1) {
      return {
        classId: null,
        error: `班级名称「${className}」存在于多个届别（${cohorts.join("、")}），请补充「届别」列`,
      };
    }
    return { classId: matches[0]?.id ?? null };
  }

  /**
   * 解析记录行（已拆好行，下标即文件行号 - 1）。
   *
   * 表头按「含 用户名」识别：缺列时该字段按空处理，不再把 `parts[-1]`
   * （末列）误当成本列的值。空行跳过但不打乱行号。
   */
  function parseRecords(lines: string[]) {
    setReceipt(null);
    setImportError("");
    setParseIssues([]);
    setPreviewRows([]);
    setPlan(null); // 名单变了，旧预检结果作废（防止按旧判定提交）

    const firstIndex = lines.findIndex((l) => l.trim() !== "");
    if (firstIndex < 0) return;

    const firstParts = parseCSVLine(lines[firstIndex].replace(BOM, ""));
    const isHeader = firstParts.includes("用户名");
    const columnOf = (h: string) => (isHeader ? firstParts.indexOf(h) : CSV_HEADERS.indexOf(h));
    const cellOf = (parts: string[], h: string) => {
      const idx = columnOf(h);
      return idx >= 0 ? (parts[idx] ?? "") : "";
    };

    const issues: RowIssue[] = [];
    const rows: PreviewRow[] = [];

    for (let i = isHeader ? firstIndex + 1 : firstIndex; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      const line = i + 1;
      const parts = parseCSVLine(raw);

      const username = cellOf(parts, "用户名");
      const password = cellOf(parts, "密码");
      const displayName = cellOf(parts, "姓名");
      const role = cellOf(parts, "角色") || "student";
      const studentId = cellOf(parts, "学号") || null;
      const schoolName = cellOf(parts, "学校");
      const cohortLabel = cellOf(parts, "届别");
      const className = cellOf(parts, "班级名称");

      if (!username || !password || !displayName) {
        issues.push({ line, message: `第${line}行(${username || "?"}): 用户名/密码/姓名不能为空` });
        continue;
      }
      if (password.length < 6) {
        issues.push({ line, message: `第${line}行(${username}): 密码长度不能少于6位` });
        continue;
      }
      if (role !== "student") {
        issues.push({ line, message: `第${line}行(${username}): 仅支持学生角色（当前: ${role}）` });
        continue;
      }

      let classId: number | null = null;
      if (className) {
        const resolved = resolveClass(className, cohortLabel, schoolName);
        if (resolved.error) {
          issues.push({ line, message: `第${line}行(${username}): ${resolved.error}` });
          continue;
        }
        classId = resolved.classId;
      }

      rows.push({
        line,
        user: {
          username,
          password,
          display_name: displayName,
          role: "student",
          student_id: studentId,
          school_name: schoolName || null,
          class_name: className || null,
          cohort_label: cohortLabel || null,
          class_id: classId,
        },
      });
    }

    setParseIssues(issues);
    setPreviewRows(rows);
  }

  function parseBatchText(text: string) {
    parseRecords(splitRecords(text));
  }

  function parseCSVFile(file: File) {
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
      parseRecords(splitRecords(text));
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDownloadTemplate() {
    // 模板只放「能直接改」的示例：学号是身份键（同校同学号会被并入而不是再建账号），
    // 学校写「院校管理」里的全名，届别与班级名一起才唯一确定一个班。UTF-8 BOM 让 Excel
    // 双击打开不乱码。
    const csvContent =
      BOM +
      CSV_HEADERS.join(",") +
      "\n" +
      "student01,123456,张三,student,2024211102011,杭州师范大学,2024级,护理241\n" +
      "student02,123456,李四,student,2024211102012,杭州师范大学,2024级,护理241\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "学生导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePreview() {
    if (previewRows.length === 0 || previewing) return;
    setPreviewing(true);
    setImportError("");
    try {
      setPlan(await onPreview(previewRows.map((r) => r.user)));
    } catch (e: unknown) {
      setPlan(null);
      setImportError(getApiErrorDetail(e, "预检失败"));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (previewRows.length === 0 || submitting) return;
    // 防呆：没预检不许提交。预检与提交共用后端同一份判定，先看一遍才不会「导完才发现
    // 同学号被跳过」。
    if (!plan) {
      setImportError("请先点「预检」确认每行会被新建、并入还是跳过");
      return;
    }
    setSubmitting(true);
    setImportError("");
    try {
      const result = await onImport(previewRows.map((r) => r.user));
      setReceipt({
        created: result.created,
        linked: result.linked,
        skipped: result.skipped,
        submitted: previewRows.length,
        notSubmitted: parseIssues.length,
        rows: result.skipped_rows.map((s) => ({
          // 后端行序 = 本批次的提交顺序；对回 CSV 行号后管理员才能直接改文件。
          line: previewRows[s.index - 1]?.line ?? s.index,
          message: `${s.username}: ${s.reason}`,
        })),
      });
      setPreviewRows([]);
      setPlan(null);
      setParseIssues([]);
      setBatchText("");
    } catch (e: unknown) {
      setImportError(getApiErrorDetail(e, "批量导入失败"));
    } finally {
      setSubmitting(false);
    }
  }

  function classCell(u: BatchUser) {
    if (!u.class_name) return "-";
    const label = u.cohort_label ? `${u.cohort_label} ${u.class_name}` : u.class_name;
    return u.class_id != null ? label : `${label}（将新建）`;
  }

  /** 预检结果单元格：并入必须能看出并入到谁，否则管理员无法判断对不对人。 */
  function planCell(row: BatchPreviewResult["rows"][number] | undefined) {
    if (!row) {
      return (
        <Text size="xs" c="dimmed">
          待预检
        </Text>
      );
    }
    if (row.action === "create") {
      return (
        <Text size="xs" c="teal.7">
          新建
        </Text>
      );
    }
    if (row.action === "link") {
      return (
        <Text size="xs" c="blue.7">
          并入 {row.existing_username}（{row.existing_display_name}）
        </Text>
      );
    }
    return (
      <Text size="xs" c="red.7">
        {row.reason}
      </Text>
    );
  }

  const partiallySkipped = receipt !== null && receipt.skipped > 0;

  return (
    <Modal
      opened={open}
      onClose={handleClose}
      title={<><IconUsers size={20} /> 批量导入学生</>}
      size={800}
      centered
      withinPortal
    >
        <Text size="xs" c="dimmed" mb="md">
          支持 CSV 文件上传或直接粘贴文本。表头行自动识别，无表头按位置匹配。
          仅限创建<strong>学生</strong>角色账号；班级不存在时自动创建。
          <br />
          <strong>学号是身份键</strong>：本校同一学号已有学生账号时，这一行会「并入」那个账号并补上班级归属，
          不新建第二个账号（训练历史跟着人走）；学号相同但姓名不同会跳过，交给人工核对。
          「学校」列填「院校管理」里的院校名称：平台角色每行必须给出学校或已存在的班级之一；
          院校管理员可留空（自动落本校），填了就必须是本校。
          学校不存在、或学校与班级所属院校不一致时，该行报错丢弃。
          同名班级存在于多个届别/院校时，必须补充「届别」或用「学校」消歧。
          <br />
          提交前先点「预检」：逐行告知将新建、并入（到哪个账号）还是跳过，预检不写任何数据。
        </Text>
        {receipt ? (
          <Stack gap="sm" mb="md">
            <Alert
              color={partiallySkipped ? "orange" : "teal"}
              variant="light"
              title={partiallySkipped ? "导入部分完成" : "导入完成"}
              icon={<IconCircleCheck size={16} />}
            >
              <Text size="sm">
                新建 {receipt.created} 人 · 并入既有账号 {receipt.linked} 人 · 跳过 {receipt.skipped} 人 · 提交{" "}
                {receipt.submitted} 行
                {receipt.notSubmitted > 0
                  ? `（另有 ${receipt.notSubmitted} 行未通过本地校验，未提交）`
                  : ""}
              </Text>
            </Alert>
            {receipt.rows.length > 0 && (
              <Box>
                <Text fw={600} size="sm" mb="xs">
                  未入库 {receipt.rows.length} 行（按 CSV 行号）
                </Text>
                <Stack gap={4} style={{ maxHeight: 240, overflowY: "auto" }}>
                  {receipt.rows.map((row, i) => (
                    <Group key={`${row.line}-${i}`} gap={6} align="flex-start" wrap="nowrap">
                      <IconAlertCircle size={13} style={{ flexShrink: 0, marginTop: 3 }} />
                      <Text size="xs">
                        第{row.line}行 {row.message}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        ) : (
          <>
            <Box mb="md">
              <Group gap={6} mb={8}>
                <IconFileText size={14} />
                <Text fw={600} size="sm">粘贴文本（每行一个学生，逗号分隔）</Text>
              </Group>
              <Textarea
                rows={5}
                placeholder={`${CSV_HEADERS.join(",")}\nstudent01,123456,张同学,student,S2024001,<院校名称>,2024级,护理1班`}
                value={batchText}
                onChange={(e) => { setBatchText(e.currentTarget.value); parseBatchText(e.currentTarget.value); }}
                disabled={submitting}
                style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
              />
              <Text size="xs" c="dimmed" mt={4}>
                列顺序：{CSV_HEADERS.join(" / ")}（学校、届别与班级名称按需填写）
              </Text>
            </Box>
            <Group gap={12} mb="md" wrap="wrap">
              <Button
                variant="light"
                color="gray"
                size="sm"
                leftSection={<IconUpload size={14} />}
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                上传 CSV 文件
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setBatchText(""); parseCSVFile(f); } e.target.value = ""; }}
                hidden
                disabled={submitting}
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
            {importError && (
              <Alert color="red" variant="light" mb="md" icon={<IconAlertCircle size={16} />}>
                <Text size="xs">{importError}</Text>
              </Alert>
            )}
            {parseIssues.length > 0 && (
              <Alert color="red" variant="light" mb="md" style={{ maxHeight: 200, overflowY: "auto" }}>
                <Stack gap={4}>
                  <Text size="xs" fw={600}>
                    未通过校验 {parseIssues.length} 行（不会提交）
                  </Text>
                  {parseIssues.map((issue, i) => (
                    <Group key={`${issue.line}-${i}`} gap={6} align="flex-start" wrap="nowrap">
                      <IconAlertCircle size={13} style={{ flexShrink: 0, marginTop: 3 }} />
                      <Text size="xs">{issue.message}</Text>
                    </Group>
                  ))}
                </Stack>
              </Alert>
            )}
            {previewRows.length > 0 && (
              <Box mb="md">
                <Group gap={8} mb="xs" justify="space-between">
                  <Text fw={600} size="sm">
                    预览（{previewRows.length} 名学生）
                  </Text>
                  {plan && (
                    <Text size="xs" c="dimmed">
                      将新建 {plan.create} 人 · 并入 {plan.link} 人 · 跳过 {plan.skip} 人
                    </Text>
                  )}
                </Group>
                <TableScroll minWidth={1000} maxHeight={240}>
                  <Table stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>行</Table.Th>
                        {CSV_HEADERS.map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                        <Table.Th>预检结果</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {previewRows.map(({ line, user: u }, i) => {
                        const row = plan?.rows[i];
                        return (
                          <Table.Tr key={line}>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {line}
                              </Text>
                            </Table.Td>
                            <Table.Td>{u.username}</Table.Td>
                            <Table.Td>{"*".repeat(Math.min(u.password.length, 8))}</Table.Td>
                            <Table.Td>{u.display_name}</Table.Td>
                            <Table.Td>
                              <RoleBadge
                                role={u.role}
                                label={roles.find((r) => r.name === u.role)?.display_name || u.role}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {u.student_id || "-"}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {u.school_name || "-"}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {u.cohort_label || "-"}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {classCell(u)}
                              </Text>
                            </Table.Td>
                            <Table.Td>{planCell(row)}</Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </TableScroll>
              </Box>
            )}
          </>
        )}
        <Group gap={12} justify="flex-end">
          {receipt ? (
            <Button onClick={handleClose}>完成</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>取消</Button>
              <Button
                variant="light"
                onClick={handlePreview}
                loading={previewing}
                disabled={previewRows.length === 0 || submitting || previewing}
              >
                预检
              </Button>
              <Button
                disabled={
                  previewRows.length === 0 ||
                  submitting ||
                  !plan ||
                  plan.create + plan.link === 0
                }
                onClick={handleImport}
              >
                {submitting ? "导入中..." : `导入 ${previewRows.length} 名学生`}
              </Button>
            </>
          )}
        </Group>
    </Modal>
  );
}
