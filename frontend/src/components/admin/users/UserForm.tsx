import { useEffect, useState } from "react";
import { Box, Button, Group, Modal, Select, Stack } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";

import { TextInput } from "@mantine/core";
import { FormMessageBanner } from "@/components/ui/form-message-banner";
import {
  type EditUserValues,
  editUserSchema,
  type RegisterUserValues,
  registerUserSchema,
} from "@/schemas/user";
import type { ClassItem } from "@/types/store";
import { useConfirm } from "@/components/ui/confirm";
import MembershipEditor from "./MembershipEditor";
import type {
  EditUserFormValues,
  MembershipDraft,
  RoleOption,
  UserBrief,
  UserFormValues,
} from "./types";

interface UserFormProps {
  open: boolean;
  user: UserBrief | null;
  roles: RoleOption[];
  /** 全部班级（含 cohort_label），用于归属选择。 */
  classes: ClassItem[];
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

/** `UserBrief.memberships` → 表单草稿。 */
function toDrafts(user: UserBrief | null): MembershipDraft[] {
  return (user?.memberships ?? [])
    .filter((m) => m.class_id != null)
    .map((m) => ({
      class_id: String(m.class_id),
      member_role: m.member_role === "teacher" ? "teacher" : "student",
    }));
}

export default function UserForm({
  open,
  user,
  roles,
  classes,
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
      memberships: [],
    },
    validate: schemaResolver(registerUserSchema),
  });

  const editForm = useForm<EditUserValues>({
    initialValues: {
      display_name: "",
      student_id: "",
      role: "",
      password: "",
      memberships: [],
    },
    validate: schemaResolver(editUserSchema),
  });

  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const { confirm } = useConfirm();

  useEffect(() => {
    if (dirtyRef) {
      dirtyRef.current = isEdit ? editForm.isDirty() : regForm.isDirty();
    }
  }, [dirtyRef, isEdit, regForm.values, editForm.values]);

  useEffect(() => {
    if (!open) return;
    if (user) {
      editForm.setValues({
        display_name: user.display_name,
        student_id: user.student_id || "",
        role: user.role,
        password: "",
        memberships: toDrafts(user),
      });
      editForm.resetDirty();
    } else {
      regForm.setValues({
        username: "",
        password: "",
        role: "student",
        display_name: "",
        student_id: "",
        memberships: [],
      });
      regForm.resetDirty();
    }
  }, [open, user]);

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

  const guardClose = async (dirty: boolean): Promise<boolean> => {
    if (!dirty) return true;
    return confirm({
      title: "未保存的更改",
      message: "内容未保存，确定关闭？",
      danger: true,
    });
  };

  if (isEdit) {
    return (
      <Modal
        opened={open}
        onClose={async () => {
          if (!(await guardClose(editForm.isDirty()))) return;
          onClose();
        }}
        title={`编辑用户: ${user?.display_name}`}
        size={520}
        centered
        withinPortal
      >
          <FormMessageBanner type="error" message={editUserMsg} />
          <form onSubmit={editForm.onSubmit(onEditSubmit)}>
            <Stack gap="md">
              <TextInput label="姓名" withAsterisk {...editForm.getInputProps("display_name")} />
              <TextInput label="学号" {...editForm.getInputProps("student_id")} />
              <Select
                label="角色" withAsterisk
                {...editForm.getInputProps("role")}
                data={roleData(roles)}
                placeholder={roles.length === 0 ? "加载中..." : undefined}
                allowDeselect={false}
              />
              <MembershipEditor
                value={editForm.values.memberships}
                onChange={(memberships) => editForm.setFieldValue("memberships", memberships)}
                classes={classes}
                disabled={isSaving}
              />
              <TextInput
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
                    if (!(await guardClose(editForm.isDirty()))) return;
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
        if (!(await guardClose(regForm.isDirty()))) return;
        onClose();
      }}
      title="添加用户"
      size={680}
      centered
      withinPortal
    >
        <FormMessageBanner
          type={registerMsg.includes("成功") ? "success" : "error"}
          message={registerMsg}
        />
        <form onSubmit={regForm.onSubmit(onRegisterSubmit)}>
          <Stack gap="md">
            <Group gap="xs" align="flex-end" wrap="wrap">
              <Box flex={1} miw={120}>
                <TextInput label="用户名" withAsterisk {...regForm.getInputProps("username")} />
              </Box>
              <Box flex={1} miw={120}>
                <TextInput
                  type="password"
                  label="密码" withAsterisk
                  placeholder="至少6位"
                  {...regForm.getInputProps("password")}
                />
              </Box>
              <Box flex={1} miw={100}>
                <Select
                  label="角色" withAsterisk
                  {...regForm.getInputProps("role")}
                  data={roleData(roles)}
                  placeholder={roles.length === 0 ? "加载中..." : undefined}
                  allowDeselect={false}
                />
              </Box>
              <Box flex={1} miw={120}>
                <TextInput label="姓名" withAsterisk {...regForm.getInputProps("display_name")} />
              </Box>
              <Box flex={1} miw={100}>
                <TextInput label="学号" {...regForm.getInputProps("student_id")} />
              </Box>
            </Group>
            <MembershipEditor
              value={regForm.values.memberships}
              onChange={(memberships) => regForm.setFieldValue("memberships", memberships)}
              classes={classes}
              disabled={isSaving}
            />
            <Group justify="flex-end" gap={8}>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "注册中..." : "注册"}
              </Button>
            </Group>
          </Stack>
        </form>
    </Modal>
  );
}
