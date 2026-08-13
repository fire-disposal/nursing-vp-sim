import { useEffect, useState } from "react";
import { Box, Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";

import { Input } from "@/components/ui/input";
import { FormMessageBanner } from "@/components/ui/form-message-banner";
import {
  type EditUserValues,
  editUserSchema,
  type RegisterUserValues,
  registerUserSchema,
} from "@/schemas/user";
import type { ClassItem, Grade } from "@/types/store";
import { useConfirm } from "@/components/ui/confirm";
import type {
  EditUserFormValues,
  RoleOption,
  UserBrief,
  UserFormValues,
} from "./types";

interface UserFormProps {
  open: boolean;
  user: UserBrief | null;
  roles: RoleOption[];
  grades: Grade[];
  allClasses: ClassItem[];
  getClassesForGrade: (gradeId: string) => Promise<ClassItem[]>;
  onClose: () => void;
  onSaveRegister: (values: UserFormValues) => void;
  onSaveEdit: (values: EditUserFormValues) => void;
  onResetPassword: (password: string) => Promise<void>;
  registerMsg: string;
  editUserMsg: string;
  isSaving: boolean;
  dirtyRef?: React.MutableRefObject<boolean>;
}

const roleData = (roles: RoleOption[]) =>
  roles.map((r) => ({ value: r.name, label: r.display_name }));

export default function UserForm({
  open,
  user,
  roles,
  grades,
  allClasses,
  getClassesForGrade,
  onClose,
  onSaveRegister,
  onSaveEdit,
  onResetPassword,
  registerMsg,
  editUserMsg,
  isSaving,
  dirtyRef,
}: UserFormProps) {
  const isEdit = user !== null;

  const regForm = useForm<RegisterUserValues>({
    initialValues: {
      username: "",
      password: "",
      role: "student",
      display_name: "",
      student_id: "",
      class_id: "",
    },
    validate: schemaResolver(registerUserSchema),
  });

  const editForm = useForm<EditUserValues>({
    initialValues: {
      display_name: "",
      student_id: "",
      role: "",
      password: "",
      class_id: "",
    },
    validate: schemaResolver(editUserSchema),
  });

  const [regGrade, setRegGrade] = useState("");
  const [regClasses, setRegClasses] = useState<ClassItem[]>([]);

  const [editGrade, setEditGrade] = useState("");
  const [editClasses, setEditClasses] = useState<ClassItem[]>([]);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const { confirm } = useConfirm();

  useEffect(() => {
    if (dirtyRef) {
      dirtyRef.current = isEdit ? editForm.isDirty() : regForm.isDirty();
    }
  }, [dirtyRef, isEdit, regForm.values, editForm.values]);

  useEffect(() => {
    if (open) {
      if (user) {
        editForm.setValues({
          display_name: user.display_name,
          student_id: user.student_id || "",
          role: user.role,
          password: "",
          class_id: user.class_id != null ? String(user.class_id) : "",
        });
        editForm.resetDirty();
        if (user.class_id) {
          const found = allClasses.find((c) => c.id === user.class_id);
          if (found) {
            setEditGrade(String(found.grade_id));
            getClassesForGrade(String(found.grade_id))
              .then(setEditClasses)
              .catch(() => setEditClasses([]));
          }
        }
      } else {
        regForm.setValues({
          username: "",
          password: "",
          role: "student",
          display_name: "",
          student_id: "",
          class_id: "",
        });
        regForm.resetDirty();
        setRegGrade("");
        setRegClasses([]);
      }
    }
  }, [open, user]);

  const handleRegGradeChange = async (gradeId: string) => {
    setRegGrade(gradeId);
    regForm.setFieldValue("class_id", "");
    if (gradeId) {
      try {
        const classes = await getClassesForGrade(gradeId);
        setRegClasses(classes);
      } catch {
        setRegClasses([]);
      }
    } else {
      setRegClasses([]);
    }
  };

  const handleEditGradeChange = async (gradeId: string) => {
    setEditGrade(gradeId);
    editForm.setFieldValue("class_id", "");
    if (gradeId) {
      try {
        const classes = await getClassesForGrade(gradeId);
        setEditClasses(classes);
      } catch {
        setEditClasses([]);
      }
    } else {
      setEditClasses([]);
    }
  };

  const onRegisterSubmit = (values: RegisterUserValues) => {
    onSaveRegister(values as UserFormValues);
  };

  const onEditSubmit = (values: EditUserValues) => {
    onSaveEdit(values as unknown as EditUserFormValues);
  };

  const handleResetPassword = async () => {
    if (isResetting) return;
    setIsResetting(true);
    setResetError("");
    try {
      const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const newPwd = Array.from(bytes, (b) => chars[b % chars.length]).join("");
      await onResetPassword(newPwd);
    } catch {
      setResetError("密码重置失败，请重试");
    } finally {
      setIsResetting(false);
    }
  };

  if (isEdit) {
    return (
      <Modal
        opened={open}
        onClose={async () => {
          if (editForm.isDirty()) {
            const ok = await confirm({
              title: "未保存的更改",
              message: "内容未保存，确定关闭？",
              danger: true,
            });
            if (!ok) return;
          }
          onClose();
        }}
        title={`编辑用户: ${user?.display_name}`}
        size={480}
        centered
        withinPortal
      >
          <FormMessageBanner type="error" message={editUserMsg} />
          <form onSubmit={editForm.onSubmit(onEditSubmit)}>
            <Stack gap="md">
              <Input label="姓名" {...editForm.getInputProps("display_name")} />
              <Input label="学号" {...editForm.getInputProps("student_id")} />
              <Select
                label="角色"
                {...editForm.getInputProps("role")}
                data={roleData(roles)}
                placeholder={roles.length === 0 ? "加载中..." : undefined}
                allowDeselect={false}
              />
              <Box>
                <Text size="xs" c="dimmed" fw={600} mb={4}>
                  年级
                </Text>
                <Select
                  value={editGrade}
                  onChange={(v) => handleEditGradeChange(v ?? "")}
                  data={[
                    { value: "", label: "不指定" },
                    ...grades.map((g) => ({
                      value: String(g.id),
                      label: g.name,
                    })),
                  ]}
                  allowDeselect={false}
                />
              </Box>
              <Box>
                <Text size="xs" c="dimmed" fw={600} mb={4}>
                  班级
                </Text>
                <Select
                  {...editForm.getInputProps("class_id")}
                  data={[
                    { value: "", label: "不指定" },
                    ...editClasses.map((c) => ({
                      value: String(c.id),
                      label: c.name,
                    })),
                  ]}
                  disabled={!editGrade}
                  allowDeselect={false}
                />
              </Box>
              <Input
                type="password"
                label="新密码（留空不修改）"
                placeholder="至少6位"
                {...editForm.getInputProps("password")}
              />
              <FormMessageBanner type="error" message={resetError} />
              <Box>
                <Button
                  type="button"
                  variant="transparent"
                  size="sm"
                  onClick={handleResetPassword}
                  disabled={isResetting}
                >
                  {isResetting ? "重置中..." : "重置密码"}
                </Button>
              </Box>
              <Group justify="flex-end" gap={8} pt="xs">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (editForm.isDirty()) {
                      const ok = await confirm({
                        title: "未保存的更改",
                        message: "内容未保存，确定关闭？",
                        danger: true,
                      });
                      if (!ok) return;
                    }
                    onClose();
                  }}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "保存中..." : "保存"}
                </Button>
              </Group>
            </Stack>
          </form>
      </Modal>
    );
  }

  return (
    <Modal
      opened={open}
      onClose={async () => {
        if (regForm.isDirty()) {
          const ok = await confirm({
            title: "未保存的更改",
            message: "内容未保存，确定关闭？",
            danger: true,
          });
          if (!ok) return;
        }
        onClose();
      }}
      title="添加用户"
      size={780}
      centered
      withinPortal
    >
        <FormMessageBanner
          type={registerMsg.includes("成功") ? "success" : "error"}
          message={registerMsg}
        />
        <form onSubmit={regForm.onSubmit(onRegisterSubmit)}>
          <Group gap="xs" align="flex-end" wrap="wrap">
            <Box flex={1} miw={120}>
              <Input label="用户名" {...regForm.getInputProps("username")} />
            </Box>
            <Box flex={1} miw={120}>
              <Input
                type="password"
                label="密码"
                placeholder="至少6位"
                {...regForm.getInputProps("password")}
              />
            </Box>
            <Box flex={1} miw={100}>
              <Select
                label="角色"
                {...regForm.getInputProps("role")}
                data={roleData(roles)}
                placeholder={roles.length === 0 ? "加载中..." : undefined}
                allowDeselect={false}
              />
            </Box>
            <Box flex={1} miw={120}>
              <Input label="姓名" {...regForm.getInputProps("display_name")} />
            </Box>
            <Box flex={1} miw={100}>
              <Input label="学号" {...regForm.getInputProps("student_id")} />
            </Box>
            <Box flex={1} miw={120}>
              <Text size="xs" c="dimmed" fw={600} mb={4}>
                年级
              </Text>
              <Select
                value={regGrade}
                onChange={(v) => handleRegGradeChange(v ?? "")}
                data={[
                  { value: "", label: "不指定" },
                  ...grades.map((g) => ({
                    value: String(g.id),
                    label: g.name,
                  })),
                ]}
                allowDeselect={false}
              />
            </Box>
            <Box flex={1} miw={120}>
              <Text size="xs" c="dimmed" fw={600} mb={4}>
                班级
              </Text>
              <Select
                {...regForm.getInputProps("class_id")}
                data={[
                  { value: "", label: "不指定" },
                  ...regClasses.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  })),
                ]}
                disabled={!regGrade}
                allowDeselect={false}
              />
            </Box>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "注册中..." : "注册"}
            </Button>
          </Group>
        </form>
    </Modal>
  );
}
