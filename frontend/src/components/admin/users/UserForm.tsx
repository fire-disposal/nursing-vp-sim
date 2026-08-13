import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Group, Select, Stack, Text } from "@mantine/core";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
    resolver: zodResolver(registerUserSchema),
    defaultValues: {
      username: "",
      password: "",
      role: "student",
      display_name: "",
      student_id: "",
      class_id: "",
    },
  });

  const editForm = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      display_name: "",
      student_id: "",
      role: "",
      password: "",
      class_id: "",
    },
  });

  const [regGrade, setRegGrade] = useState("");
  const [regClasses, setRegClasses] = useState<ClassItem[]>([]);

  const [editGrade, setEditGrade] = useState("");
  const [editClasses, setEditClasses] = useState<ClassItem[]>([]);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const { confirm } = useConfirm();

  const { isDirty: regDirty } = regForm.formState;
  const { isDirty: editDirty } = editForm.formState;

  useEffect(() => {
    if (dirtyRef) {
      dirtyRef.current = isEdit ? editDirty : regDirty;
    }
  }, [dirtyRef, isEdit, regDirty, editDirty]);

  useEffect(() => {
    if (open) {
      if (user) {
        editForm.reset({
          display_name: user.display_name,
          student_id: user.student_id || "",
          role: user.role,
          password: "",
          class_id: user.class_id != null ? String(user.class_id) : "",
        });
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
        regForm.reset({
          username: "",
          password: "",
          role: "student",
          display_name: "",
          student_id: "",
          class_id: "",
        });
        setRegGrade("");
        setRegClasses([]);
      }
    }
  }, [open, user]);

  const handleRegGradeChange = async (gradeId: string) => {
    setRegGrade(gradeId);
    regForm.setValue("class_id", "");
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
    editForm.setValue("class_id", "");
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
      <Dialog
        open={open}
        onOpenChange={async (o) => {
          if (!o && editForm.formState.isDirty) {
            const ok = await confirm({
              title: "未保存的更改",
              message: "内容未保存，确定关闭？",
              danger: true,
            });
            if (!ok) return;
          }
          if (!o) onClose();
        }}
      >
        <DialogContent title={`编辑用户: ${user?.display_name}`} maxWidth={480}>
          <FormMessageBanner type="error" message={editUserMsg} />
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)}>
              <Stack gap="md">
                <FormField
                  control={editForm.control}
                  name="display_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>姓名</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="student_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>学号</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>角色</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? "")}
                          data={roleData(roles)}
                          placeholder={roles.length === 0 ? "加载中..." : undefined}
                          allowDeselect={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
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
                    value={editForm.watch("class_id")}
                    onChange={(v) => editForm.setValue("class_id", v ?? "")}
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
                <FormField
                  control={editForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>新密码（留空不修改）</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="至少6位"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormMessageBanner type="error" message={resetError} />
                <Box>
                  <Button
                    type="button"
                    variant="link"
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
                      if (editForm.formState.isDirty) {
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
          </Form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={async (o) => {
        if (!o && regForm.formState.isDirty) {
          const ok = await confirm({
            title: "未保存的更改",
            message: "内容未保存，确定关闭？",
            danger: true,
          });
          if (!ok) return;
        }
        if (!o) onClose();
      }}
    >
      <DialogContent title="添加用户" maxWidth={780}>
        <FormMessageBanner
          type={registerMsg.includes("成功") ? "success" : "error"}
          message={registerMsg}
        />
        <Form {...regForm}>
          <form onSubmit={regForm.handleSubmit(onRegisterSubmit)}>
            <Group gap="xs" align="flex-end" wrap="wrap">
              <Box flex={1} miw={120}>
                <FormField
                  control={regForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>用户名</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Box>
              <Box flex={1} miw={120}>
                <FormField
                  control={regForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>密码</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="至少6位"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Box>
              <Box flex={1} miw={100}>
                <FormField
                  control={regForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>角色</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? "")}
                          data={roleData(roles)}
                          placeholder={roles.length === 0 ? "加载中..." : undefined}
                          allowDeselect={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Box>
              <Box flex={1} miw={120}>
                <FormField
                  control={regForm.control}
                  name="display_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>姓名</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Box>
              <Box flex={1} miw={100}>
                <FormField
                  control={regForm.control}
                  name="student_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>学号</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                  value={regForm.watch("class_id")}
                  onChange={(v) => regForm.setValue("class_id", v ?? "")}
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
        </Form>
      </DialogContent>
    </Dialog>
  );
}
