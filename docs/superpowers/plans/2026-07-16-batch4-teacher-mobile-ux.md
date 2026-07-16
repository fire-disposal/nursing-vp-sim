# 批次四：教师端与移动端体验 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修通 practice features、作业 is_closed + 修改守卫 + 逾期口径统一、作业统计、is_test 标记+排除、学生视角预览、rubric JSON化+只读页、密码管理 UX、移动端"我的"Tab、问卷触发接线、abandoned 端点+UI、管理端 UX 小项
**Architecture:** 前端 React 19 + TypeScript + TanStack Query，后端 FastAPI + SQLAlchemy ORM，thin router→service→repository 分层
**Tech Stack:** react-hook-form, zod, zustand, FastAPI, pytest, Alembic
**Spec:** docs/superpowers/specs/2026-07-16-prototype-consolidation-design.md（批次四）
---

## Task 1 — D20: 修通 practice features（前端表单 + payload）

**Files:**
- Modify: `frontend/src/pages/admin/PracticesPage.tsx` (:114-123, :285-392)
- Read-only ref: `frontend/src/engine/capabilities.gen.ts` (:16-62), `frontend/src/schemas/practice.ts`

- [ ] **Step 1**: 修改 `PracticesPage.tsx` 表单 features 区——将只读显示 (:362-391) 替换为可切换开关，根据选中病例的 `training_type` 过滤 `ALL_CAPABILITIES` 中 `tier==='toggleable'` 的项
  ```tsx
  // 替换 :362-391 的 FormField render 为：
  render={({ field }) => {
    const selectedCaseId = form.watch("case_id");
    const selectedCase = cases.find((c) => c.id === selectedCaseId);
    const caps = selectedCase?.capabilities;
    const features = (field.value as Record<string, boolean>) || {};
    const trainingType = selectedCase?.training_type || "history_taking";
    const toggleableKeys = Object.entries(ALL_CAPABILITIES)
      .filter(([, def]) => def.tier === "toggleable")
      .map(([k]) => k);
    const relevantKeys = toggleableKeys.filter(
      (k) => !ALL_CAPABILITIES[k].trainingTypes || ALL_CAPABILITIES[k].trainingTypes!.includes(trainingType)
    );
    return (
      <FormItem>
        <FormLabel>训练能力</FormLabel>
        <div className="space-y-2 py-1">
          {relevantKeys.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {selectedCaseId ? "该类型无可配置能力" : "请先选择病例"}
            </span>
          ) : (
            relevantKeys.map((k) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={features[k] ?? false}
                  onChange={(e) => {
                    const next = { ...features, [k]: e.target.checked };
                    // 清理无关 key
                    for (const key of Object.keys(next)) {
                      if (!relevantKeys.includes(key)) delete next[key];
                    }
                    field.onChange(next);
                  }}
                  className="rounded border-border"
                />
                <span>{ALL_CAPABILITIES[k]?.label ?? k}</span>
                <span className="text-xs text-muted-foreground">{ALL_CAPABILITIES[k]?.description ?? ""}</span>
              </label>
            ))
          )}
        </div>
        <FormMessage />
      </FormItem>
    );
  }}
  ```

- [ ] **Step 2**: 修改 `onSubmit` (:119) `features: {}` → `features: values.features`
  ```ts
  // 将 :119 的 features: {}, 改为：
  features: values.features || {},
  ```

- [ ] **Step 3**: 修改表格"能力"列 (:174-192)——改为显示 practice.features 与病例默认合并
  ```tsx
  // 替换 :178-192 render 为：
  render: (p) => {
    const caseCaps = cases.find((c) => c.id === p.case_id);
    const caseDefaults = caseCaps?.capabilities ?? {};
    const practiceFeatures = p.features ?? {};
    const merged: Record<string, boolean> = { ...caseDefaults, ...practiceFeatures };
    const enabled = Object.entries(merged).filter(([, v]) => v);
    if (enabled.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-wrap gap-0.5">
        {enabled.map(([k]) => (
          <span key={k} className="inline-flex items-center rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary">
            {ALL_CAPABILITIES[k]?.label ?? k}
          </span>
        ))}
      </span>
    );
  },
  ```

- [ ] **Step 4**: 编辑时回填 features (:99-108)——form.reset 中已有 `features: d.features || {}`，确认已正确回填（行 103 已存在，无需改动）

- [ ] **Step 5**: 验证——`npx tsc --noEmit` + `npx biome check`（workdir `frontend/`）
- [ ] **Step 6**: 手测——新建/编辑练习，开关 patient_initiative/physical_exam/nursing_record，保存后刷新看到 correct merged 能力列
- [ ] **Step 7**: commit: `✨ feat: practice features checkbox form and submit`

---

## Task 2 — D21: 作业 is_closed（迁移 + service + 学生端 + 教师端）

**Files:**
- Create: `backend/migrations/versions/ddl/<uuid>_add_assignment_is_closed.py`
- Modify: `backend/models/case_practice.py` (:59-79)
- Modify: `backend/schemas/assignment.py` (:18-26, :28-39)
- Modify: `backend/services/assignment.py` (:188-230)
- Modify: `backend/services/student.py` (:46-75)
- Modify: `backend/contexts/training/router/session.py` (:280-375)
- Modify: `frontend/src/components/dashboard/AssignmentCardList.tsx` (:63-143)
- Modify: `frontend/src/pages/admin/AssignmentsPage.tsx` (:151-173)
- Test: `backend/tests/admin/test_assignment_flow.py`

- [ ] **Step 1**: 生成迁移
  ```bash
  pnpm run db:migration -- "add assignment is_closed"
  ```
  完整 upgrade/downgrade：
  ```python
  # upgrade
  op.add_column("assignments", sa.Column("is_closed", sa.Boolean(), server_default=sa.text("false"), nullable=False))
  
  # downgrade
  op.drop_column("assignments", "is_closed")
  ```

- [ ] **Step 2**: 模型加列——`backend/models/case_practice.py` Assignment 类 (:67 后) 加：
  ```python
  is_closed: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
  ```

- [ ] **Step 3**: Schema 加 is_closed——`AssignmentUpdateRequest` (:18-26) 加：
  ```python
  is_closed: bool | None = None
  ```
  `AssignmentListItem` (:28-39) 加：
  ```python
  is_closed: bool = False
  ```

- [ ] **Step 4**: `services/assignment.py` update 方法 (:188-230) 加 is_closed 处理——在 `if end_time is not None:` 后加：
  ```python
  if req.is_closed is not None:
      assignment.is_closed = req.is_closed
  ```
  路由 `assignments.py` update_assignment (:121-136) 传参加 `is_closed=req.is_closed`。

- [ ] **Step 5**: `start_training_from_assignment` 加 is_closed 守卫——在 `session.py` :293（assignment 查询后）加：
  ```python
  if assignment.is_closed:
      raise HTTPException(status_code=400, detail="该作业已被教师关闭")
  ```

- [ ] **Step 6**: 学生端 `services/student.py` (:46-75)——关闭的作业标记 status 为 `"closed"`：
  在行 46 `for a in assignments:` 循环开头加：
  ```python
  if a.is_closed:
      items.append(StudentAssignmentItem(
          id=a.id, title=a.title,
          practice_name=a.practice.name if a.practice else "",
          start_time=a.start_time, end_time=a.end_time,
          status="closed",
      ))
      continue
  ```

- [ ] **Step 7**: 前端 AssignmentCardList——已关闭的作业 (:62-143) 加"已关闭"徽章、隐藏按钮
  在 `a.status === "closed"` 时渲染：
  ```tsx
  // 在 isOverdue/isCompleted 判断后加：
  const isClosed = a.status === "closed";
  ```
  卡片内：`isClosed` 时显示 Badge variant="outline" "已关闭"，不渲染开始/补做按钮

- [ ] **Step 8**: AssignmentsPage 列表操作加关闭/开放切换——columns actions (:221-248) 加按钮
  ```tsx
  <Button variant="ghost" size="icon" onClick={() => handleToggleClose(a)} title={a.is_closed ? "重新开放" : "关闭"}>
    {a.is_closed ? <Play size={15} /> : <XCircle size={15} />}
  </Button>
  ```
  加 handleToggleClose：
  ```ts
  const handleToggleClose = async (a: AssignmentRow) => {
    const ok = await confirm({
      title: a.is_closed ? "重新开放作业" : "关闭作业",
      message: a.is_closed ? "重新开放后学生可继续练习，确定？" : "关闭后学生无法开始新练习，已在进行的仍可完成，确定？",
    });
    if (!ok) return;
    await updateAssignment(a.id, { is_closed: !a.is_closed });
    queryClient.invalidateQueries({ queryKey: queryKeys.assignments.all });
    toast.success(a.is_closed ? "已重新开放" : "已关闭");
  };
  ```
  需要引入 `XCircle` from lucide-react。

- [ ] **Step 9**: roundtrip 验证
  ```bash
  cd backend; uv run alembic downgrade -1; uv run alembic upgrade head
  ```
  确保迁移可逆。

- [ ] **Step 10**: 后端测试——写 TDD 测试 `test_is_closed_blocks_start`
  ```python
  def test_is_closed_blocks_student_start(self, client, teacher, student, test_case, test_class, test_student_in_class, db_session):
      _, teacher_token = teacher
      _, student_token = student
      practice = Practice(name="关闭测试", description="", case_id=test_case.id, features={}, behavior={"time_limit_minutes": 20})
      db_session.add(practice); db_session.commit()
      now = datetime.now(UTC)
      resp = client.post("/api/assignments", json={
          "practice_id": practice.id, "class_id": test_class.id,
          "title": "关闭测试作业", "start_time": now.isoformat(),
          "end_time": (now + timedelta(days=7)).isoformat(),
      }, headers=_auth_headers(teacher_token))
      assignment_id = resp.json()["id"]
      # 关闭作业
      client.put(f"/api/assignments/{assignment_id}", json={"is_closed": True}, headers=_auth_headers(teacher_token))
      # 学生尝试开始
      resp2 = client.post(f"/api/training/start-from-assignment?assignment_id={assignment_id}", headers=_auth_headers(student_token))
      assert resp2.status_code == 400
      assert "关闭" in resp2.json()["detail"]
  ```
  验证：`uv run python -m pytest tests/admin/test_assignment_flow.py -x -q`（workdir `backend/`）

- [ ] **Step 11**: commit: `✨ feat: assignment is_closed with migration, guard, and UI toggle`

---

## Task 3 — 4.3: 作业修改守卫 + 逾期口径统一

**Files:**
- Modify: `backend/services/assignment.py` (:67-118, :188-230)
- Modify: `backend/schemas/assignment.py` (:41-53)
- Modify: `frontend/src/pages/admin/AssignmentDetailPage.tsx` (:176-198)

- [ ] **Step 1**: `_build_detail_view` (:67-118) 逾期口径修正——`:82 status=record.status` 改为当 `record.is_overdue and record.status != "completed"` 时 `status="overdue"`
  ```python
  # 替换 :82 行：
  status = record.status
  if record.is_overdue and status != "completed":
      status = "overdue"
  # 然后下方 :82-88 使用 status 变量
  ```
  `scored_count` 和 `completed_count` 排除 overdue（仅统计真正 completed）——当前 :99-100 已用 `s.status == "completed"` 和 `s.scoring_status == "completed"`，无需改。

- [ ] **Step 2**: `AssignmentStudentItem` schema (:41-53) 已含 `is_overdue: bool = False`（行 52），确认无误。`_student_resp` 映射已在 routers/assignments.py :58 传 `is_overdue=view.is_overdue`。

- [ ] **Step 3**: `update` 方法 (:188-230) 加修改守卫——在 :202 AuthError 检查后 + practice_id/class_id 赋值前，加：
  ```python
  if practice_id is not None or class_id is not None:
      if self.repo.has_any_records(assignment_id):
          raise ValidationError("已有学生开始练习，不能更换练习或班级")
  ```

- [ ] **Step 4**: 前端 AssignmentDetailPage 状态列加逾期小标——在 statusBadge 渲染后针对 `is_overdue` 为 true 且 status 为 "completed" 的行，完成时间旁加"逾期提交"标记
  ```tsx
  // 在 TableCell (完成时间列 :194-198) 改为：
  <TableCell className="text-xs text-muted-foreground">
    {s.end_time ? new Date(s.end_time).toLocaleString("zh-CN") : "-"}
    {s.status === "completed" && s.is_overdue && (
      <span className="ml-1 text-[10px] text-destructive">逾期提交</span>
    )}
  </TableCell>
  ```

- [ ] **Step 5**: `StudentAssignmentItem` schema (:74-83) 加 `is_overdue: bool = False`——学生端也可看逾期标记（前端 AssignmentCardList 已有 overdue 状态渲染）

- [ ] **Step 6**: 验证——`cd backend && uv run python -m pytest tests/admin/test_assignment_flow.py -x -q`
- [ ] **Step 7**: commit: `🐛 fix: overdue display in assignment detail + edit guard for practice/class change`

---

## Task 4 — D23: 作业统计（avg/max/min/completion_rate + 前端卡片 + 分布条）

**Files:**
- Modify: `backend/services/assignment.py` (:43-118)
- Modify: `backend/schemas/assignment.py` (:55-71)
- Modify: `backend/routers/assignments.py` (:62-79)
- Modify: `frontend/src/pages/admin/AssignmentDetailPage.tsx` (:109-214)

- [ ] **Step 1**: `AssignmentDetailView` dataclass (:43-59) 加统计字段：
  ```python
  avg_score: float | None = None
  max_score: float | None = None
  min_score: float | None = None
  completion_rate: float = 0.0
  ```

- [ ] **Step 2**: `AssignmentDetail` schema (:55-71) 加对应字段：
  ```python
  avg_score: float | None = None
  max_score: float | None = None
  min_score: float | None = None
  completion_rate: float = 0.0
  ```

- [ ] **Step 3**: `_build_detail_view` 计算统计——基于 D3 的"每生最佳记录"口径（排除 is_test）。在 student_items 构建完成后计算：
  ```python
  scored_students = [s for s in student_items if s.scoring_status == "completed" and s.score_total is not None]
  if scored_students:
      scores = [s.score_total for s in scored_students]
      avg_score = round(sum(scores) / len(scores), 1) if scores else None
      max_score = round(max(scores), 1)
      min_score = round(min(scores), 1)
  else:
      avg_score = max_score = min_score = None
  completed_students = sum(1 for s in student_items if s.status == "completed")
  completion_rate = round(completed_students / len(student_items), 2) if student_items else 0.0
  ```
  `AssignmentDetailView` 构造中传入这 4 个字段。

- [ ] **Step 4**: `_detail_resp` (:62-79) 映射新字段到 AssignmentDetail：
  ```python
  avg_score=view.avg_score,
  max_score=view.max_score,
  min_score=view.min_score,
  completion_rate=view.completion_rate,
  ```

- [ ] **Step 5**: 前端 AssignmentDetailPage——替换统计卡片区 (:109-156) 为 5 项卡片 + 分布条
  ```tsx
  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
    <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">总人数</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{detail.student_count}</div></CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">已完成</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-success-foreground">{detail.completed_count}</div></CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">已评分</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{detail.scored_count}</div></CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">完成率</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{(detail.completion_rate * 100).toFixed(0)}%</div></CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">均分/最高</CardTitle></CardHeader><CardContent>
      <div className="text-lg font-bold">{detail.avg_score != null ? detail.avg_score : "-"}</div>
      <div className="text-xs text-muted-foreground">最高 {detail.max_score ?? "-"} / 最低 {detail.min_score ?? "-"}</div>
    </CardContent></Card>
  </div>
  {/* 分数分布条 */}
  {detail.avg_score != null && (
    <Card className="mt-4">
      <CardHeader className="pb-2"><CardTitle className="text-sm">分数分布</CardTitle></CardHeader>
      <CardContent>
        <ScoreDistributionBar students={detail.students as any[]} />
      </CardContent>
    </Card>
  )}
  ```
  新增 `ScoreDistributionBar` 组件（同文件内）：
  ```tsx
  function ScoreDistributionBar({ students }: { students: { score_total?: number | null; scoring_status?: string | null }[] }) {
    const scored = students.filter(s => s.scoring_status === "completed" && s.score_total != null).map(s => s.score_total!);
    if (scored.length === 0) return <p className="text-xs text-muted-foreground">暂无评分数据</p>;
    const buckets = [
      { label: "0-59", lo: 0, hi: 59 },
      { label: "60-69", lo: 60, hi: 69 },
      { label: "70-79", lo: 70, hi: 79 },
      { label: "80-89", lo: 80, hi: 89 },
      { label: "90-100", lo: 90, hi: 100 },
    ];
    const counts = buckets.map(b => scored.filter(s => s >= b.lo && s <= b.hi).length);
    const max = Math.max(...counts, 1);
    return (
      <div className="space-y-1.5">
        {buckets.map((b, i) => (
          <div key={b.label} className="flex items-center gap-2 text-xs">
            <span className="w-10 text-right text-muted-foreground">{b.label}</span>
            <div className="flex-1 h-5 bg-muted rounded">
              <div className="h-full bg-primary rounded transition-all" style={{ width: `${(counts[i] / max) * 100}%` }} />
            </div>
            <span className="w-6 text-right">{counts[i]}</span>
          </div>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 6**: 验证——`cd backend && uv run python -m pytest tests/admin/test_assignment_flow.py -x -q`，前端 `npx tsc --noEmit && npx biome check`
- [ ] **Step 7**: commit: `✨ feat: assignment stats avg/max/min/completion_rate + score distribution bar`

---

## Task 5 — D19: is_test（迁移 + _create_record 自动标记 + 统计排除）

**Files:**
- Create: `backend/migrations/versions/ddl/<uuid>_add_is_test_column.py`
- Modify: `backend/models/training.py` (:29-67)
- Modify: `backend/contexts/training/router/session.py` (:141-226)
- Modify: `backend/services/stats.py` (:36-48, :59-78, :113-147, :160-202, :219-264)
- Modify: `backend/services/user.py` (:160-205)
- Modify: `backend/services/assignment.py` (:67-88, :99-100)
- Modify: `backend/services/student.py` (:34-43)
- Modify: `backend/routers/assignments.py` (:164-210)

- [ ] **Step 1**: 生成迁移
  ```bash
  pnpm run db:migration -- "add is_test column to training_records"
  ```
  完整 upgrade/downgrade：
  ```python
  op.add_column("training_records", sa.Column("is_test", sa.Boolean(), server_default=sa.text("false"), nullable=False))
  # downgrade
  op.drop_column("training_records", "is_test")
  ```

- [ ] **Step 2**: 模型加列——`backend/models/training.py` TrainingRecord 类 (`is_overdue` :66 后) 加：
  ```python
  is_test: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
  ```

- [ ] **Step 3**: `_create_record` (:141-226)——在 `db.add(record)` (:175) 前加：
  ```python
  # 检查当前用户是否为管理权限（通过 db 查询 user 的 role permissions）
  from core.security import load_role_permissions
  user = db.query(User).filter(User.id == user_id).first()
  if user:
      user_perms = load_role_permissions(db, user.role_id)
      if "case_manage" in user_perms or "score_review" in user_perms:
          record.is_test = True
  ```
  需要 import `load_role_permissions` 和 `User`。
  注意：`_create_record` 签名没有 `current_user` 对象，只有 `user_id`。需要查 DB 获取 user 信息。

- [ ] **Step 4**: stats.py 排除 is_test——全量查询添加 `.filter(TrainingRecord.is_test == False)` 过滤：
  - `get_duration_stats` (:36-48) base 加 `.filter(TrainingRecord.is_test == False)`（在 status filter 后）
  - `get_trends` (:59-78) base 加 `.filter(TrainingRecord.is_test == False)`
  - `teacher_summary` (:113-147) outerjoin TrainingRecord 条件加 `& (TrainingRecord.is_test == False)`
  - `student_ranking` (:160-202) outerjoin TrainingRecord 条件加 `& (TrainingRecord.is_test == False)`
  - `class_summary` (:219-264) outerjoin TrainingRecord 条件加 `& (TrainingRecord.is_test == False)`

- [ ] **Step 5**: `services/user.py` (:160-205) `get_stats`——所有 TrainingRecord 查询加 `.filter(TrainingRecord.is_test == False)`：
  - total_records (:169)
  - completed_records (:170)
  - avg_score query (:171-175)
  - avg_duration query (:178-188)
  - today_records (:190-196)

- [ ] **Step 6**: `services/assignment.py` `_build_detail_view`——`completed_count` (:99) 和 `scored_count` (:100) 统计排除 is_test：
  `training_records` 查询（`get_records_for_assignment`）加 `.filter(TrainingRecord.is_test == False)`

- [ ] **Step 7**: `services/student.py` (:34-43) records 查询加 `.filter(TrainingRecord.is_test == False)`

- [ ] **Step 8**: routers/assignments.py export (:164-175) 加 `.filter(TrainingRecord.is_test == False)`

- [ ] **Step 9**: roundtrip 验证
  ```bash
  cd backend; uv run alembic downgrade -1; uv run alembic upgrade head
  ```

- [ ] **Step 10**: 后端测试
  ```python
  def test_admin_training_is_test(self, client, teacher, test_case, db_session):
      _, token = teacher
      resp = client.post("/api/training/start", json={"case_id": test_case.id}, headers=_auth_headers(token))
      assert resp.status_code == 200
      record_id = resp.json()["record_id"]
      from models import TrainingRecord
      record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
      assert record.is_test == True
  ```
  验证：`uv run python -m pytest tests/admin/test_assignment_flow.py -x -q`

- [ ] **Step 11**: commit: `✨ feat: is_test auto-flag for admin users + exclude from all stats`

---

## Task 6 — D17: 学生视角预览（authStore + 守卫 + banner + 退出）

**Files:**
- Modify: `frontend/src/stores/authStore.ts` (:1-166)
- Modify: `frontend/src/pages/DashboardHome.tsx` (:19, :24, :30, :43, :46-48)
- Modify: `frontend/src/components/Layout.tsx` (:106-108, :114, :142-157)
- Modify: `frontend/src/pages/TrainingSelect.tsx`（无需改——当前无 isAdmin 守卫）

- [ ] **Step 1**: authStore 加 `previewAsStudent: boolean`——在 `ExtendedAuthState` interface 和 persist partialize 中：
  ```ts
  // interface ExtendedAuthState 加：
  previewAsStudent: boolean;
  setPreviewAsStudent: (v: boolean) => void;
  
  // 初始 state 加：
  previewAsStudent: false,
  setPreviewAsStudent: (v: boolean) => set({ previewAsStudent: v }),
  
  // partialize 改为不 persist previewAsStudent（session 级别，刷新即消失）：
  // partialize 只保留 user/token/permissions，不需要改。
  // 但 previewAsStudent 不应 persist 到 localStorage——保持默认 false，不在 persist 中。
  // previewAsStudent 不走 persist，是运行时状态。只在 zustand 的 transient 部分。
  ```
  注意：zustand persist 的 partialize 已排除 previewAsStudent（仅 persist user/token/permissions），previewAsStudent 为纯运行时。

- [ ] **Step 2**: DashboardHome (:19, :24, :30, :43, :46-48)——添加 `previewAsStudent` 判断
  ```tsx
  const previewAsStudent = useAuthStore((s) => s.previewAsStudent);
  // :24 enabled: !isAdmin 改为 enabled: !isAdmin || previewAsStudent
  // :30 enabled: !isAdmin 改为 enabled: !isAdmin || previewAsStudent
  // :43 enabled: !isAdmin 改为 enabled: !isAdmin || previewAsStudent
  // :46-48 改为：
  if (isAdmin && !previewAsStudent) {
    return <Navigate to="/admin" replace />;
  }
  ```

- [ ] **Step 3**: Layout (:114, :142-157)——加 `previewAsStudent` 判断
  ```tsx
  const previewAsStudent = useAuthStore((s) => s.previewAsStudent);
  // :142 改为：
  if (!hasAdminPerm || previewAsStudent) {
  ```
  管理端顶栏 (AdminSidebar 上方) 加预览 banner：
  ```tsx
  // 在 :142 if (!hasAdminPerm) { 上方插入：
  if (hasAdminPerm && previewAsStudent) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          <span>学生视角预览模式</span>
          <button
            onClick={() => {
              useAuthStore.getState().setPreviewAsStudent(false);
              navigate("/admin");
            }}
            className="text-xs underline hover:no-underline"
          >
            退出预览
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {/* 复用 Student 布局 */}
        </div>
      </div>
    );
  }
  ```
  但上面的 return 会让整个 Layout 只渲染 banner。更好的方式是在 content JSX 前加 banner：
  ```tsx
  // 在 :141 行 const content = ... 前加：
  const previewBanner = hasAdminPerm && previewAsStudent ? (
    <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200 shrink-0">
      <span>学生视角预览模式</span>
      <button
        onClick={() => {
          useAuthStore.getState().setPreviewAsStudent(false);
          navigate("/admin");
        }}
        className="text-xs underline hover:no-underline"
      >
        退出预览
      </button>
    </div>
  ) : null;
  ```
  然后在 content 外层包裹：
  ```tsx
  {previewBanner}
  {content}
  ```

- [ ] **Step 4**: 管理端侧边栏加"学生视角预览"入口——在 `AdminSidebar` 或 admin 页面加按钮
  在 Admin 首页或 Layout 的 admin 区域顶栏加：
  ```tsx
  <button
    onClick={() => {
      useAuthStore.getState().setPreviewAsStudent(true);
      navigate("/home");
    }}
    className="..."
  >
    <Eye size={16} /> 学生视角
  </button>
  ```
  最简单位置：`frontend/src/pages/Admin.tsx` 或其他管理首页加入口。

- [ ] **Step 5**: 验证——`npx tsc --noEmit && npx biome check`（workdir `frontend/`）
- [ ] **Step 6**: 手测——管理员点击"学生视角" → 看到学生首页 + 顶部 banner → 能自由训练 → 点"退出预览"回 /admin
- [ ] **Step 7**: commit: `✨ feat: admin preview as student mode with banner and toggle`

---

## Task 7 — D18: rubric JSON 化 + 只读页（mtime 热更 + 端点 + 页面 + 导航）

**Files:**
- Create: `backend/profiles/history_taking/rubric.json`（从 rubric.py 的 RUBRIC 字典复制）
- Modify: `backend/profiles/history_taking/rubric.py`（改为 read from JSON）
- Modify: `backend/repositories/rubric.py` (:1-55)
- Create: `backend/routers/rubrics.py`（新路由 `GET /api/rubrics/current`）
- Create: `frontend/src/pages/admin/RubricPage.tsx`
- Modify: `frontend/src/config/navigation.tsx` (:180-196)
- Modify: `backend/main.py`（注册 routers/rubrics）

- [ ] **Step 1**: 创建 `backend/profiles/history_taking/rubric.json`——从 `rubric.py` 的 `RUBRIC` 字典导出为 JSON 文件（直接 copy 字典内容，去掉 Python 语法）。完整内容同 rubric.py 的 RUBRIC 变量。

- [ ] **Step 2**: 修改 `rubric.py`——从 JSON 文件 load：
  ```python
  import json
  from pathlib import Path
  
  _RUBRIC_PATH = Path(__file__).parent / "rubric.json"
  
  def _load_from_json() -> dict:
      with open(_RUBRIC_PATH, "r", encoding="utf-8") as f:
          return json.load(f)
  
  RUBRIC = _load_from_json()
  ```
  保留 `RUBRIC` 变量以便现有 import 不报错。

- [ ] **Step 3**: `repositories/rubric.py` `load_rubric` (:6-15)——改为读 JSON 文件 + mtime 缓存：
  ```python
  import json
  import os
  from pathlib import Path
  
  _CACHE: dict[str, tuple[dict, float]] = {}  # {version: (data, mtime)}
  _RUBRIC_DIR = Path(__file__).parent.parent / "profiles" / "history_taking"
  
  def load_rubric(version: str = "nursing_history_v1") -> dict:
      filepath = _RUBRIC_DIR / "rubric.json"
      if not filepath.exists():
          raise FileNotFoundError(f"评分标准文件未找到: {filepath}")
      mtime = os.path.getmtime(filepath)
      if version in _CACHE and _CACHE[version][1] == mtime:
          return _CACHE[version][0]
      with open(filepath, "r", encoding="utf-8") as f:
          data = json.load(f)
      _CACHE[version] = (data, mtime)
      return data
  ```

- [ ] **Step 4**: 创建 `backend/routers/rubrics.py`——新端点 `GET /api/rubrics/current`（`score_review` 权限）
  ```python
  from typing import Annotated
  from fastapi import APIRouter, Depends
  from core.deps import DbSession
  from core.security import require_permission
  from models import User
  from repositories.rubric import load_rubric
  
  router = APIRouter(prefix="/api/rubrics", tags=["评分标准"])
  
  @router.get("/current")
  def get_current_rubric(
      current_user: Annotated[User, Depends(require_permission("score_review"))],
      db: DbSession,
  ):
      return load_rubric()
  ```

- [ ] **Step 5**: 注册路由——`backend/main.py` 加：
  ```python
  from routers import rubrics as rubrics_router
  app.include_router(rubrics_router.router)
  ```

- [ ] **Step 6**: `pnpm run api:update`（仓库根目录）

- [ ] **Step 7**: 创建前端只读页 `frontend/src/pages/admin/RubricPage.tsx`
  ```tsx
  import { useQuery } from "@tanstack/react-query";
  import { api } from "@/api/client";
  import type { ApiPath } from "@/api/api-path";
  import LoadingSkeleton from "@/components/ui/loading-skeleton";
  import PageHeader from "@/components/ui/page-header";
  
  export default function RubricPage() {
    const { data, isLoading } = useQuery({
      queryKey: ["rubric", "current"],
      queryFn: () => api.get("/rubrics/current" satisfies ApiPath as string).then(r => r.data),
      staleTime: 30 * 60_000,
    });
  
    if (isLoading) return <LoadingSkeleton />;
    if (!data) return <div className="p-8 text-center text-muted-foreground">加载失败</div>;
  
    const rubric = data as {
      name: string; version: string; total_max: number; scale: number;
      dimensions: { id: string; name: string; max: number; description?: string; items: { id: string; name: string; anchors: Record<string, string> }[] }[];
    };
  
    return (
      <div className="space-y-6">
        <PageHeader title="评分标准" subtitle={`${rubric.name} · v${rubric.version} · 满分 ${rubric.total_max} 分`} />
        <p className="text-xs text-muted-foreground">此页面为只读视图，修改评分标准请编辑服务器上的 JSON 配置文件，改动后自动生效。</p>
        {rubric.dimensions.map((dim) => (
          <div key={dim.id} className="rounded-xl border bg-card">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">{dim.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">满分 {dim.max} 分 · {dim.description || ""}</p>
            </div>
            <div className="divide-y">
              {dim.items.map((item) => (
                <div key={item.id} className="px-6 py-4">
                  <p className="text-sm font-medium">{item.name}</p>
                  <div className="mt-2 space-y-1">
                    {Object.entries(item.anchors).map(([score, desc]) => (
                      <div key={score} className="flex items-start gap-3 text-sm">
                        <span className="font-mono font-bold text-primary shrink-0 w-6">{score}分</span>
                        <span className="text-muted-foreground">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 8**: 导航注册——`frontend/src/config/navigation.tsx` :180-196 的"练习管理"后加：
  ```tsx
  {
    path: "/admin/rubric",
    element: <RubricPage />,  // 需要添加 lazy import
    permission: "score_review",
    nav: { label: "评分标准", icon: BookOpen, section: "admin" },
  },
  ```
  添加 import：`const RubricPage = lazy(() => import("@/pages/admin/RubricPage"));`
  添加 icon import：`BookOpen` from lucide-react

- [ ] **Step 9**: 验证——`cd backend && uv run python -m pytest -x -q`，`cd frontend && npx tsc --noEmit && npx biome check`
- [ ] **Step 10**: 手测——管理员访问 /admin/rubric 看到评分标准 → 修改 rubric.json 后刷新页面看到更新
- [ ] **Step 11**: commit: `✨ feat: rubric JSON config with mtime hot-reload + read-only admin page`

---

## Task 8 — D14+D15: 密码管理 UX（重置按钮 + 展示 Dialog + Login 文案 + is_active 登录 403）

**Files:**
- Modify: `frontend/src/components/admin/users/UserForm.tsx` (:152-271)
- Modify: `frontend/src/components/admin/UsersTab.tsx` (:183-206)
- Modify: `frontend/src/pages/Login.tsx` (:179-183)
- Modify: `backend/services/auth.py` (:70-81)
- Modify: `backend/routers/auth.py` (:31-41)

- [ ] **Step 1**: UserForm 编辑态加"重置密码"按钮——在 edit form 密码栏 (:245-258) 后加：
  ```tsx
  <div className="mb-4">
    <button
      type="button"
      className="text-sm text-primary underline hover:no-underline"
      onClick={() => {
        const newPwd = Array.from({ length: 8 }, () => {
          const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
          return chars[Math.floor(Math.random() * chars.length)];
        }).join("");
        setEditForm((f) => ({ ...f, password: newPwd }));
        setResetPwdShow(newPwd);
      }}
    >
      随机生成密码
    </button>
  </div>
  ```
  加状态：`const [resetPwdShow, setResetPwdShow] = useState<string | null>(null);`

- [ ] **Step 2**: 保存成功后展示密码 Dialog——UserForm 的 `onSaveEdit` 回调在 `UsersTab.tsx` :183-206 中。修改 handleSaveEdit 成功后检查 payload 中的 password：
  ```tsx
  // 在 :196-199 onSuccess 中：
  onSuccess: () => {
    resetToFirstPage();
    closeUserForm();
    if (form.password) {
      setResetPasswordDialog({ user: editingUser!, password: form.password });
    }
  },
  ```
  UsersTab 加状态 `const [resetPasswordDialog, setResetPasswordDialog] = useState<{user: UserBrief; password: string} | null>(null);` 和渲染：
  ```tsx
  {resetPasswordDialog && (
    <Dialog open onOpenChange={() => setResetPasswordDialog(null)}>
      <DialogContent title="密码已重置" maxWidth={400}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">用户 <strong>{resetPasswordDialog.user.display_name}</strong> 的密码已重置，请妥善保存：</p>
          <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
            <code className="flex-1 text-lg font-mono font-bold select-all">{resetPasswordDialog.password}</code>
            <button
              className="text-xs text-primary underline"
              onClick={() => { navigator.clipboard.writeText(resetPasswordDialog.password); }}
            >
              复制
            </button>
          </div>
          <p className="text-xs text-destructive">此密码仅展示一次，请立即告知用户并建议其登录后修改</p>
        </div>
        <div className="flex justify-end mt-4">
          <button className={btnPrimary} onClick={() => setResetPasswordDialog(null)}>知道了</button>
        </div>
      </DialogContent>
    </Dialog>
  )}
  ```

- [ ] **Step 3**: Login 页面加联系教师文案——`Login.tsx` :179-183 改为：
  ```tsx
  <p className="mt-6 text-center text-xs text-muted-foreground lg:text-left lg:pl-0">
    忘记密码？请联系教师或管理员重置
  </p>
  ```

- [ ] **Step 4**: 登录端点 `auth.py` login (:70-81)——认证成功后加 is_active 检查：
  ```python
  async def login(self, username: str, password: str) -> User:
      strategy = get_strategy_registry()["password"](self.db)
      user = await strategy.authenticate({"username": username, "password": password})
      if user is None:
          log.warning("登录失败: username=%s", username, extra={"action": "login_failed"})
          raise AuthError(detail="用户名或密码错误")
      if not user.is_active:
          raise AuthError(detail="账号已被禁用，请联系管理员", status_code=403)
      ...
  ```
  注意：策略 authenticate 返回的 user 已经过 DB 查询；is_active 在 DB 中有此列（`models/auth.py` User 模型），直接检查即可。

- [ ] **Step 5**: 验证——后端 `cd backend && uv run python -m pytest tests/ -x -q`，前端 `cd frontend && npx tsc --noEmit && npx biome check`
- [ ] **Step 6**: 手测——管理端编辑用户 → 点"随机生成密码" → 保存 → 弹出 Dialog 展示密码+复制按钮 → 登录页看到联系教师文案 → 禁用用户登录时报 403
- [ ] **Step 7**: commit: `✨ feat: admin reset password + display once dialog + login is_active 403 + forgot password hint`

---

## Task 9 — D25: 移动端"我的"Tab（StudentTabShell + Profile 扩充）

**Files:**
- Modify: `frontend/src/components/shell/StudentTabShell.tsx` (:45-57)
- Modify: `frontend/src/pages/Profile.tsx` (:92-309)
- Read-only ref: `frontend/src/config/navigation.tsx`（/my-responses, /my-feedback, /stats 路由）

- [ ] **Step 1**: StudentTabShell 第 4 个 tab 改为"我的"——`BOTTOM_TABS` (:45-57) ：
  ```tsx
  const BOTTOM_TABS = [
    { to: "/home", icon: Home, label: "首页", shortLabel: "首页", end: true },
    { to: "/training", icon: Stethoscope, label: "病例训练", shortLabel: "训练" },
    { to: "/history", icon: ClipboardList, label: "训练记录", shortLabel: "记录" },
    { to: "/profile", icon: User, label: "我的", shortLabel: "我的" },
    { to: "/qa", icon: HelpCircle, label: "护理问答", shortLabel: "问答" },
  ];
  ```
  移除 `/my-responses` tab，icon `User` 已在 imports 中（User form lucide-react）

- [ ] **Step 2**: Profile 页扩充入口列表——在"账户安全"区 (:209-225) 后加：
  ```tsx
  <div className="rounded-xl border border-border bg-card p-6">
    <h3 className="mb-3 text-sm font-semibold">快捷入口</h3>
    <div className="space-y-0.5">
      <QuickLink to="/my-responses" icon={ClipboardCheck} label="我的问卷" desc="查看已完成的问卷调查" />
      <QuickLink to="/my-feedback" icon={MessageSquare} label="我的反馈" desc="提交意见反馈和问题报告" />
      <QuickLink to="/stats" icon={BarChart3} label="训练统计" desc="查看训练时长和成绩趋势" />
      <QuickLink to="/qa" icon={HelpCircle} label="护理问答" desc="护理知识问答练习" />
    </div>
  </div>
  ```
  新增 `QuickLink` 组件（同文件内）：
  ```tsx
  function QuickLink({ to, icon: Icon, label, desc }: { to: string; icon: React.ComponentType<{ size?: number }>; label: string; desc: string }) {
    const navigate = useNavigate();
    return (
      <button
        onClick={() => navigate(to)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
      >
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <ChevronRight size={16} className="text-muted-foreground shrink-0" />
      </button>
    );
  }
  ```
  需要添加 imports：
  ```tsx
  import { ChevronRight, ClipboardCheck, HelpCircle, BarChart3, MessageSquare } from "lucide-react";
  import { useNavigate } from "react-router-dom";
  ```

- [ ] **Step 3**: 验证——`cd frontend && npx tsc --noEmit && npx biome check`
- [ ] **Step 4**: 手测——移动端/窄屏看到底部第 4 个 Tab "我的" → 点击进入 /profile → 看到个人信息 + 快捷入口列表 → 点击各入口正确跳转
- [ ] **Step 5**: commit: `✨ feat: mobile tab "我的" with profile entry links`

---

## Task 10 — D11: 问卷触发接线（before_training + after_scoring）

**Files:**
- Modify: `frontend/src/pages/TrainingEntry.tsx` (:1-54)
- Modify: `frontend/src/pages/RecordDetail.tsx` (:1-294)

- [ ] **Step 1**: TrainingEntry——接入 before_training 问卷
  ```tsx
  // 在 TrainingEntry 组件内加：
  import { useQuestionnaire } from "@/hooks/useQuestionnaire";
  import { QuestionnaireModal } from "@/components/QuestionnaireModal";
  
  // 在 record 加载后加：
  const caseId = record?.case_id;
  const {
    checkResponse,
    isLoading: qLoading,
    shouldShow: qShouldShow,
    check: qCheck,
    submit: qSubmit,
    dismiss: qDismiss,
  } = useQuestionnaire({
    caseId: caseId ?? null,
    trigger: "before_training",
  });
  
  // useEffect 自动 check：
  useEffect(() => {
    if (caseId) qCheck();
  }, [caseId]);
  
  // 替换 :45-48 的 pendingQ banner 为 QuestionnaireModal：
  ```

  实际修改：
  -  第 41 行附近加 `useQuestionnaire` 和 `useEffect`
  - 替换 pendingQ banner (:45-48) 为：
  ```tsx
  {qShouldShow && checkResponse && (
    <QuestionnaireModal
      open={qShouldShow}
      onComplete={() => { qCheck(); }}
      onSkip={qDismiss}
      checkResponse={checkResponse}
      loading={qLoading}
      onSubmit={qSubmit}
    />
  )}
  ```
  保留 pendingQ banner 作为 fallback（当问卷非必填且被 skip 后显示提示）：
  ```tsx
  {pendingQ > 0 && !qShouldShow && (
    <div className="bg-info/10 text-info-foreground text-xs px-4 py-2 text-center border-b border-border">
      本练习包含问卷，可在训练后于「我的问卷」中完成
    </div>
  )}
  ```

- [ ] **Step 2**: RecordDetail——接入 after_scoring 问卷。在 RecordDetail 组件内加：
  ```tsx
  import { useQuestionnaire } from "@/hooks/useQuestionnaire";
  import { QuestionnaireModal } from "@/components/QuestionnaireModal";
  
  // 在 record 加载后加：
  const caseId = (record as any)?.case_id as number | undefined;
  const recordIdNum = id ? Number(id) : undefined;
  const {
    checkResponse: postCheckResponse,
    isLoading: postQLoading,
    shouldShow: postQShouldShow,
    check: postQCheck,
    submit: postQSubmit,
    dismiss: postQDismiss,
  } = useQuestionnaire({
    caseId: caseId ?? null,
    recordId: recordIdNum ?? null,
    trigger: "after_scoring",
  });
  
  // useEffect：当 scoring_status 变成 completed 时触发
  useEffect(() => {
    if ((record as any)?.scoring_status === "completed") {
      postQCheck();
    }
  }, [(record as any)?.scoring_status]);
  
  // 在 JSX 底部 (ScoreResultSection 之后) 加：
  {postQShouldShow && postCheckResponse && (
    <QuestionnaireModal
      open={postQShouldShow}
      onComplete={() => { postQCheck(); }}
      onSkip={postQDismiss}
      checkResponse={postCheckResponse}
      loading={postQLoading}
      onSubmit={postQSubmit}
    />
  )}
  ```

- [ ] **Step 3**: 验证——`cd frontend && npx tsc --noEmit && npx biome check`
- [ ] **Step 4**: 手测——有问卷的病例开始训练前弹出问卷 → 评分完成后打开记录详情弹出 after_scoring 问卷
- [ ] **Step 5**: commit: `✨ feat: wire questionnaire before_training and after_scoring triggers`

---

## Task 11 — D13: abandoned（后端端点 + History UI + 筛选 + 最佳记录排除）

**Files:**
- Modify: `backend/contexts/training/router/session.py`（新端点 :556 后）
- Modify: `frontend/src/pages/History.tsx` (:119-122, :226-249, :340-346, :367-399)
- Modify: `frontend/src/api/training.ts`（加 abandonRecord 函数）
- Modify: `backend/services/assignment.py` (:67-88)
- Read-only ref: `backend/models/training.py` (:37-40 check constraint 已含 abandoned)

- [ ] **Step 1**: 后端加 `abandon_record` 端点——在 `delete_record` (:556-590) 后加：

  ```python
  @router.put("/records/{record_id}/abandon", response_model=OkResponse)
  def abandon_record(
      record_id: int,
      current_user: Annotated[User, Depends(get_current_user)],
      db: Annotated[Session, Depends(get_db)],
      request: Request,
  ):
      record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
      if not record:
          raise NotFoundError(detail="训练记录不存在")
      if not current_user.has_permission("score_review") and record.user_id != current_user.id:
          raise AuthError(detail="无权操作此记录", status_code=403)
      if record.status != "in_progress":
          raise HTTPException(status_code=400, detail="只能放弃进行中的训练")
  
      record.status = "abandoned"
      record.end_time = datetime.now(UTC)
      # 清理 initiative/emotion 缓存
      db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).delete()
      db.commit()
  
      log.info(
          f"训练记录放弃: record_id={record_id}",
          extra={"user_id": current_user.id, "action": "training_abandon"},
      )
      return {"message": "训练记录已放弃"}
  ```
  需要 import `OkResponse`（已在 schemas 中）和 `TrainingSessionState`。

- [ ] **Step 2**: 前端 api——`frontend/src/api/training.ts` 加：
  ```ts
  export const abandonRecord = (recordId: number) =>
    api.put(`/training/records/${recordId}/abandon` satisfies ApiPath as string);
  ```

- [ ] **Step 3**: History 状态筛选加"已放弃"——:119-122 select options 加：
  ```html
  <option value="abandoned">已放弃</option>
  ```

- [ ] **Step 4**: History 状态徽章——:340-346 的 Badge 映射加 abandoned：
  ```tsx
  variant={
    r.status === "completed" ? "success" :
    r.status === "abandoned" ? "secondary" :
    "info"
  }
  >
    {r.status === "completed" ? "已完成" :
     r.status === "abandoned" ? "已放弃" :
     "进行中"}
  ```

- [ ] **Step 5**: History 移动端操作 (:226-249)——进行中记录加"放弃"按钮
  ```tsx
  {isInProgress && (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={...}>
        <Play size={12} /> 继续
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
        onClick={(e) => { e.stopPropagation(); handleAbandonRecord(r); }}>
        <XCircle size={12} /> 放弃
      </Button>
    </>
  )}
  {r.status === "abandoned" && (
    <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={() => navigate(`/record/${r.id}`)}>
      查看
    </Button>
  )}
  ```

- [ ] **Step 6**: History 桌面操作 (:367-399)——同加"放弃"按钮
  ```tsx
  {r.status === "in_progress" && user?.role !== "teacher" ? (
    <>
      <Button variant="link" size="xs" onClick={() => navigate(`/training/${r.id}`)}>继续训练</Button>
      <Button variant="link" size="xs" className="text-muted-foreground"
        onClick={() => handleAbandonRecord(r)}>放弃</Button>
    </>
  ) : (
    ...
  )}
  ```

- [ ] **Step 7**: 加 `handleAbandonRecord` 函数：
  ```ts
  const abandonMutation = useMutation({
    mutationFn: (id: number) => abandonRecord(id),
    onSuccess: () => {
      toast.success("训练记录已放弃");
      queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
    },
    onError: (err: unknown) => toast.apiError(err, "操作失败"),
  });
  
  const handleAbandonRecord = async (r: TrainingRecordBrief) => {
    const ok = await confirm({
      title: "放弃训练",
      message: `确定放弃「${r.case_name}」的训练吗？放弃后将保留对话记录但不会评分。`,
      confirmLabel: "确定放弃",
      danger: true,
    });
    if (!ok) return;
    abandonMutation.mutate(r.id);
  };
  ```

- [ ] **Step 8**: 作业最佳记录排除 abandoned——`services/assignment.py` `_build_detail_view` 的 record_by_user (:70)：
  当前 `{r.user_id: r for r in training_records}` 为简单 dict 覆盖。需改为先排除 abandoned 再取最佳：
  ```python
  record_by_user: dict[int, TrainingRecord] = {}
  for r in training_records:
      if r.status == "abandoned":
          continue
      existing = record_by_user.get(r.user_id)
      if existing is None:
          record_by_user[r.user_id] = r
      else:
          # D3: 优先取有 completed 评分的最高分，否则取最新
          existing_scored = existing.scoring_status == "completed" and existing.score and existing.score.total_score is not None
          r_scored = r.scoring_status == "completed" and r.score and r.score.total_score is not None
          if r_scored and (not existing_scored or (r.score.total_score or 0) > (existing.score.total_score or 0)):
              record_by_user[r.user_id] = r
          elif not r_scored and not existing_scored and r.start_time > existing.start_time:
              record_by_user[r.user_id] = r
  ```
  注意：`training_records` 返回的是 ORM 对象，score 通过 joinedload 加载。

- [ ] **Step 9**: 验证——`cd backend && uv run python -m pytest tests/ -x -q`，前端 `cd frontend && npx tsc --noEmit && npx biome check`
- [ ] **Step 10**: 手测——进行中训练点"放弃"→ 状态变"已放弃"→ 筛选可选"已放弃"→ 作业详情中 abandoned 记录不显示
- [ ] **Step 11**: commit: `✨ feat: abandon endpoint + history UI filter/badge/button + exclude from best record`

---

## Task 12 — 4.11: 管理端 UX 小项（dirty 关闭确认 ×3 + 问卷删除告警 + 收尾）

**Files:**
- Modify: `frontend/src/components/admin/cases/CaseForm.tsx` (:31-80)
- Modify: `frontend/src/pages/admin/PracticesPage.tsx` (:280-408)
- Modify: `frontend/src/pages/admin/AssignmentsPage.tsx` (:299-452)
- Modify: `frontend/src/components/admin/QuestionnairesTab.tsx` (:175-184)

- [ ] **Step 1**: CaseForm dirty 关闭确认——CaseForm 使用自定义 form state，无 isDirty。需要维护 dirty flag：
  加 `const [isDirty, setIsDirty] = useState(false);`
  在 `updateField` / `updateList` 中 `setIsDirty(true);`
  在 `open` effect reset 时 `setIsDirty(false);`
  Dialog onOpenChange 改为：
  ```tsx
  onOpenChange={(o) => {
    if (!o) {
      if (isDirty && !window.confirm("内容未保存，确定关闭？")) return;
      onClose();
    }
  }}
  ```

- [ ] **Step 2**: PracticesPage Dialog dirty 关闭确认——使用 react-hook-form 的 `formState.isDirty`：
  ```tsx
  // :280 Dialog onOpenChange 改为：
  onOpenChange={(o) => {
    if (!o) {
      if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return;
      setModalOpen(false);
    }
  }}
  ```

- [ ] **Step 3**: AssignmentsPage Dialog dirty 关闭确认——同 PracticesPage：
  ```tsx
  // :299 Dialog onOpenChange 改为：
  onOpenChange={(o) => {
    if (!o) {
      if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return;
      setModalOpen(false);
    }
  }}
  ```

- [ ] **Step 4**: 问卷删除告警文案——`QuestionnairesTab.tsx` :176-179 confirm message 改为：
  ```tsx
  message: `确定删除问卷"${t.title}"吗？此操作将同时删除该问卷的全部学生答卷，不可恢复。`,
  ```

- [ ] **Step 5**: `pnpm run api:update`（仓库根目录——确保 D18 rubric 路由 + D21 is_closed schema 变更已同步）

- [ ] **Step 6**: `pnpm run check`（仓库根目录——后端 ruff + ty + 前端 biome + tsc）

- [ ] **Step 7**: 手测清单汇总
  1. PracticesPage 新建/编辑 → 修改 fields 后点取消 → 确认弹窗
  2. AssignmentsPage 新建/编辑 → 修改 fields 后点取消 → 确认弹窗
  3. CaseForm 编辑 → 修改后点取消 → 确认弹窗
  4. 删除问卷模板 → 确认弹窗包含"删除全部学生答卷"文案
  5. 练习能力开关保存后在学生训练中生效
  6. 关闭的作业学生无法开始
  7. 作业详情显示统计四项+分布条
  8. 管理员切换学生视角试跑（记录不入统计）
  9. rubric 只读页可见
  10. 管理端重置密码展示 Dialog
  11. 移动端底部"我的"→ profile → 快捷入口
  12. 训练前/评分后问卷弹出
  13. 进行中训练可放弃且列表可筛

- [ ] **Step 8**: commit: `✨ feat: admin UX dirty-close confirm + questionnaire delete warning`

---

**Verify checklist:** 确认 spec 4.1~4.12 全覆盖：D20 (4.1) ✓, D21 (4.2) ✓, 4.3 ✓, D23 (4.4) ✓, D17+D19 (4.5) ✓, D18 (4.6) ✓, D14+D15 (4.7) ✓, D25 (4.8) ✓, D11 (4.9) ✓, D13 (4.10) ✓, 4.11 ✓, 4.12 ✓ (is_closed 和 is_test 两个 ddl 迁移已在 Task 2 和 Task 5)。
