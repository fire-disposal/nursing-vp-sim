import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import {
  type EditUserValues,
  editUserSchema,
  type RegisterUserValues,
  registerUserSchema,
} from "@/schemas/user";
import type { ClassItem, Grade } from "@/types/store";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import type {
  EditUserFormValues,
  RoleOption,
  UserBrief,
  UserFormValues,
} from "./types";

const selectClass =
  "w-full h-10 px-3 border border-border rounded-lg bg-muted text-foreground text-sm focus-ring focus-visible:bg-card";

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
          {editUserMsg && (
            <div className="bg-destructive/10 text-destructive px-3.5 py-2.5 rounded-lg text-sm mb-4 text-left">
              {editUserMsg}
            </div>
          )}
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit(onEditSubmit)}
              className="space-y-4"
            >
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
                      <select className={selectClass} {...field}>
                        {roles.length === 0 && (
                          <option value="" disabled>
                            加载中...
                          </option>
                        )}
                        {roles.map((r) => (
                          <option key={r.name} value={r.name}>
                            {r.display_name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div>
                <label className="block text-xs text-muted-foreground font-semibold mb-1">
                  年级
                </label>
                <select
                  className={selectClass}
                  value={editGrade}
                  onChange={(e) => handleEditGradeChange(e.target.value)}
                >
                  <option value="">不指定</option>
                  {grades.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground font-semibold mb-1">
                  班级
                </label>
                <select
                  className={selectClass}
                  value={editForm.watch("class_id")}
                  onChange={(e) =>
                    editForm.setValue("class_id", e.target.value)
                  }
                  disabled={!editGrade}
                >
                  <option value="">不指定</option>
                  {editClasses.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
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
              {resetError && (
                <div className="bg-destructive/10 text-destructive px-3.5 py-2.5 rounded-lg text-sm">
                  {resetError}
                </div>
              )}
              <div>
                <button
                  type="button"
                  className="text-sm text-primary underline hover:no-underline disabled:opacity-50 disabled:no-underline"
                  onClick={handleResetPassword}
                  disabled={isResetting}
                >
                  {isResetting ? "重置中..." : "重置密码"}
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
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
              </div>
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
        {registerMsg && (
          <div
            className={cn(
              "px-3.5 py-2.5 rounded-lg text-sm mb-4 text-left",
              registerMsg.includes("成功")
                ? "bg-success text-success-foreground"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {registerMsg}
          </div>
        )}
        <Form {...regForm}>
          <form
            onSubmit={regForm.handleSubmit(onRegisterSubmit)}
            className="flex gap-3 flex-wrap items-end"
          >
            <div className="flex-[1_1_120px]">
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
            </div>
            <div className="flex-[1_1_120px]">
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
            </div>
            <div className="flex-[1_1_100px]">
              <FormField
                control={regForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>角色</FormLabel>
                    <FormControl>
                      <select className={selectClass} {...field}>
                        {roles.length === 0 && (
                          <option value="" disabled>
                            加载中...
                          </option>
                        )}
                        {roles.map((r) => (
                          <option key={r.name} value={r.name}>
                            {r.display_name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex-[1_1_120px]">
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
            </div>
            <div className="flex-[1_1_100px]">
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
            </div>
            <div className="flex-[1_1_120px]">
              <label className="block text-xs text-muted-foreground font-semibold mb-1">
                年级
              </label>
              <select
                className={selectClass}
                value={regGrade}
                onChange={(e) => handleRegGradeChange(e.target.value)}
              >
                <option value="">不指定</option>
                {grades.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-[1_1_120px]">
              <label className="block text-xs text-muted-foreground font-semibold mb-1">
                班级
              </label>
              <select
                className={selectClass}
                value={regForm.watch("class_id")}
                onChange={(e) =>
                  regForm.setValue("class_id", e.target.value)
                }
                disabled={!regGrade}
              >
                <option value="">不指定</option>
                {regClasses.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              disabled={isSaving}
              className="h-10"
            >
              {isSaving ? "注册中..." : "注册"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
