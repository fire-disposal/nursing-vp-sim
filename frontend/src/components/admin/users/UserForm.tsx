import {Box, Button, Group, Modal, MultiSelect, 
  PasswordInput, Select, Stack, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ui/confirm";
import { FormMessageBanner } from "@/components/ui/form-message-banner";
import {
  type EditUserValues,
  editUserSchema,
  type RegisterUserValues,
  registerUserSchema,
} from "@/schemas/user";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";
import type { ClassItem } from "@/types/store";
import MembershipEditor from "./MembershipEditor";
import type {
  EditUserFormValues,
  MembershipDraft,
  PersonaOption,
  SchoolOption,
  UserBrief,
  UserFormValues,
} from "./types";

/**
 * 平台视角：拥有它的账号跨院校，不属于任何院校，表单里不选单位。
 * 判定用视角键而不是退役的角色名。
 */
const PLATFORM_PERSONA = "platform";

interface UserFormProps {
  open: boolean;
  user: UserBrief | null;
  /** 可授予的视角（`/admin/personas` 目录）。 */
  personas: PersonaOption[];
  /** 视角目录请求失败（多半是无权限）：不能用「加载中」冒充。 */
  personasFailed?: boolean;
  /** 全部班级（含 cohort_label），用于归属选择。 */
  classes: ClassItem[];
  /** 可选的院校（单位）。只有平台账号能跨院校选；院校管理员由服务端强制本校。 */
  schools: SchoolOption[];
  /** 当前操作者是否平台账号（`school_manage`）：决定「单位」是否可选。 */
  isPlatform: boolean;
  onClose: () => void;
  onSaveRegister: (values: UserFormValues) => void;
  onSaveEdit: (values: EditUserFormValues) => void;
  onResetPassword: (password: string) => Promise<void>;
  registerMsg: string;
  editUserMsg: string;
  isSaving: boolean;
  dirtyRef?: React.MutableRefObject<boolean>;
}

/** 空视角目录的诚实占位：失败就说失败，别永远停在「加载中」。 */
const personasPlaceholder = (personas: PersonaOption[], failed?: boolean) =>
  personas.length > 0 ? undefined : failed ? "视角目录不可用" : "加载中...";

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
  personas,
  personasFailed,
  classes,
  schools,
  isPlatform,
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
  // 单位下拉的数据形式只需要 id/name：调用方传院校列表，这里只做一次形状转换
  const schoolOptions = schools.map((s) => ({ value: String(s.id), label: s.name }));
  // 平台账号已收窄到某一所院校时，新建账号默认落在该校（表单里锁住，避免两个答案）
  const scopedSchool = useSchoolScopeStore((s) => s.school);

  const regForm = useForm<RegisterUserValues>({
    initialValues: {
      username: "",
      password: "",
      personas: ["student"],
      display_name: "",
      student_id: "",
      school_id: "",
      memberships: [],
    },
    validate: async (values) => {
      const errors = await schemaResolver(registerUserSchema)(values);
      // 非平台账号必须有单位：服务端没有「默认院校」，缺了就 404「需要指定院校」
      if (isPlatform && !values.personas.includes(PLATFORM_PERSONA) && !values.school_id) {
        errors.school_id = "请选择所属院校";
      }
      return errors;
    },
  });

  const editForm = useForm<EditUserValues>({
    initialValues: {
      username: "",
      display_name: "",
      student_id: "",
      personas: ["student"],
      password: "",
      school_id: "",
      memberships: [],
    },
    validate: schemaResolver(editUserSchema),
  });

  // 只展示**能授予**的视角：超出调用者当前权限的档位后端会 403，
  // 给出可选项等于让用户填完再被拒。platform / ops 只能属于平台账号：
  // 编辑院校账号时不展示；新建时 platform 本身可选，ops 等需先选 platform。
  const grantablePersonas = personas.filter(
    (p) =>
      p.grantable &&
      (!p.requires_platform_account ||
        (isEdit
          ? Boolean(user?.is_platform)
          : p.value === PLATFORM_PERSONA ||
            regForm.values.personas.includes(PLATFORM_PERSONA))),
  );
  const platformOnlyKeys = new Set(
    personas
      .filter((p) => p.requires_platform_account && p.value !== PLATFORM_PERSONA)
      .map((p) => p.value),
  );
  const withoutOrphanedPlatformOnly = (values: string[]) =>
    values.includes(PLATFORM_PERSONA)
      ? values
      : values.filter((value) => !platformOnlyKeys.has(value));

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
        username: user.username,
        display_name: user.display_name,
        student_id: user.student_id || "",
        personas: user.personas ?? [],
        password: "",
        school_id: user.school_id != null ? String(user.school_id) : "",
        memberships: toDrafts(user),
      });
      editForm.resetDirty();
    } else {
      regForm.setValues({
        username: "",
        password: "",
        personas: ["student"],
        display_name: "",
        student_id: "",
        school_id: isPlatform && scopedSchool ? String(scopedSchool.id) : "",
        memberships: [],
      });
      regForm.resetDirty();
    }
  }, [open, user, isPlatform, scopedSchool]);

  // 平台账号不属于任何院校：勾上「平台」视角时把已选单位清空，避免提交出「平台 + 院校」
  useEffect(() => {
    if (regForm.values.personas.includes(PLATFORM_PERSONA) && regForm.values.school_id) {
      regForm.setFieldValue("school_id", "");
    }
    if (editForm.values.personas.includes(PLATFORM_PERSONA) && editForm.values.school_id) {
      editForm.setFieldValue("school_id", "");
    }
  }, [
    regForm.values.personas,
    regForm.values.school_id,
    editForm.values.personas,
    editForm.values.school_id,
  ]);

  // 选了班级就以班级所在院校为准（服务端注册同样是「班级优先」）：表单里不能同时存在
  // 两个互相矛盾的答案，否则账号会落进和学生所选院校不同的院校。
  const regClassSchoolId =
    isPlatform && !regForm.values.personas.includes(PLATFORM_PERSONA)
      ? classes.find((c) => String(c.id) === regForm.values.memberships[0]?.class_id)?.school_id
      : undefined;
  useEffect(() => {
    if (regClassSchoolId == null) return;
    const next = String(regClassSchoolId);
    if (regForm.values.school_id !== next) regForm.setFieldValue("school_id", next);
  }, [regClassSchoolId, regForm]);

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
        size={560}
        centered
        withinPortal
      >
          <FormMessageBanner type="error" message={editUserMsg} />
          <form onSubmit={editForm.onSubmit(onEditSubmit)}>
            <Stack gap="md">
              {/* 用户名是登录键，可改：名单/学工系统里写错时对齐名单，不重建账号（历史不动） */}
              <TextInput
                label="用户名"
                withAsterisk
                description="登录用户名；改名不影响训练记录与班级归属"
                {...editForm.getInputProps("username")}
              />
              <TextInput label="姓名" withAsterisk {...editForm.getInputProps("display_name")} />
              <TextInput label="学号" {...editForm.getInputProps("student_id")} />
              <MultiSelect
                label="视角" withAsterisk
                description="账号可被授予多个视角：登录后按当前生效视角决定权限与可见范围"
                {...editForm.getInputProps("personas")}
                onChange={(value) =>
                  editForm.setFieldValue("personas", withoutOrphanedPlatformOnly(value))
                }
                data={grantablePersonas}
                placeholder={personasPlaceholder(personas, personasFailed)}
                searchable
                clearable
              />
              {isPlatform && (
                <Select
                  label="院校"
                  {...editForm.getInputProps("school_id")}
                  data={schoolOptions}
                  placeholder={
                    editForm.values.personas.includes(PLATFORM_PERSONA)
                      ? "平台账号（不属于任何院校）"
                      : "选择所属院校"
                  }
                  // 平台账号不属于任何院校；院校管理员没有这个下拉（服务端强制本校）；
                  // 已收窄到某校时跨校搬迁需要先切到「全部院校」，否则只会得到 404
                  disabled={
                    isSaving ||
                    editForm.values.personas.includes(PLATFORM_PERSONA) ||
                    scopedSchool !== null
                  }
                  description={
                    scopedSchool !== null && !editForm.values.personas.includes(PLATFORM_PERSONA)
                      ? "跟随当前院校；如需跨院校调整，先切到「全部院校」"
                      : undefined
                  }
                  allowDeselect={false}
                />
              )}
              <MembershipEditor
                value={editForm.values.memberships}
                onChange={(memberships) => editForm.setFieldValue("memberships", memberships)}
                classes={classes}
                disabled={isSaving}
              />
              <PasswordInput
                label="新密码（留空不修改）"
                placeholder="至少6位"
                visibilityToggleFocusable
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
                <PasswordInput
                  type="password"
                  label="密码" withAsterisk
                  placeholder="至少6位"
                  {...regForm.getInputProps("password")}
                />
              </Box>
              <Box flex={1} miw={160}>
                <MultiSelect
                  label="视角" withAsterisk
                  description="可多选；默认学生"
                  {...regForm.getInputProps("personas")}
                  onChange={(value) =>
                    regForm.setFieldValue("personas", withoutOrphanedPlatformOnly(value))
                  }
                  data={grantablePersonas}
                  placeholder={personasPlaceholder(personas, personasFailed)}
                  searchable
                  clearable
                />
              </Box>
              <Box flex={1} miw={120}>
                <TextInput label="姓名" withAsterisk {...regForm.getInputProps("display_name")} />
              </Box>
              <Box flex={1} miw={100}>
                <TextInput label="学号" {...regForm.getInputProps("student_id")} />
              </Box>
              {isPlatform && (
                <Box flex={1} miw={140}>
                  <Select
                    label="院校"
                    withAsterisk={!regForm.values.personas.includes(PLATFORM_PERSONA)}
                    {...regForm.getInputProps("school_id")}
                    data={schoolOptions}
                    placeholder={
                      regForm.values.personas.includes(PLATFORM_PERSONA) ? "平台账号" : "选择所属院校"
                    }
                    // 选了班级（班级决定院校）或已收窄到某校时，这里不再让人另选一个答案
                    disabled={
                      isSaving ||
                      regForm.values.personas.includes(PLATFORM_PERSONA) ||
                      regClassSchoolId != null ||
                      scopedSchool !== null
                    }
                    description={
                      regClassSchoolId != null
                        ? "由所选班级决定"
                        : scopedSchool !== null && !regForm.values.personas.includes(PLATFORM_PERSONA)
                          ? "跟随当前院校"
                          : undefined
                    }
                    allowDeselect={false}
                  />
                </Box>
              )}
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
