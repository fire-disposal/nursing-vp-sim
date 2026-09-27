# ideas/ — 点子草稿区

未实现、论证中或已搁置的产品与技术点子。**不是正式文档**：没有决策约束力，只记录想法、可行性草稿与调研结论，供后续排期时回溯。

> **与正式决策的关系**：本区任何条目（含标注“高优先级”“实施中”者）都**不构成当前实施授权**。当前训练实施计划是
> [`docs/19-training-experience-next-generation-plan.md`](../19-training-experience-next-generation-plan.md)；
> 临床推理（第二 workflow）的去向是 [`docs/18-clinical-reasoning-disposition.md`](../18-clinical-reasoning-disposition.md)。
> 点子要进入实施，须由维护者明确采纳并转正为编号文档。

## 约定

| 项 | 规则 |
|----|------|
| 命名 | `主题名.md`，语义命名，如 `voice-call-feasibility.md`（无需编号） |
| 状态标记 | 文件头部 `> 状态：论证文档（非决策）/ 待评审 / 已否决 / 已转正 / 已冻结（历史，非实施指令）` |
| 转正 | 点子被采纳进入实施时，移出 `ideas/` 成为正式编号文档，并在 [README](../README.md) 更新 |
| 回收 | 论证结论为"不做"的，保留在 `ideas/` 并标注 `已否决` 及原因，不删除（防重复论证） |

## 现有点子

| 文档 | 状态 | 要点 |
|------|------|------|
| [电话式纯语音采集可行性](voice-call-feasibility.md) | 论证文档（非决策） | 半双工对讲机 MVP 3-5 周；B 形态 PSTN 明确不做 |
| [患者上下文机制重构](context-mechanism-redesign.md) | 四域已落地，C0 待收敛 | 保留固定消息布局、历史预算与泄漏守卫；删除单命名空间注册器、伪跨轮缓存和无消费者接口 |
| [Seedance 视频情绪循环系统](seedance-emotion-loop-design.md) | 待评审（暂不实施） | 5 原型×2 变体通用 mood loop + 双缓冲边界调度；防素材膨胀 D1-D4 |
| [提示词与上下文版本管理](prompt-context-versioning.md) | V1 只读归因已实施，E1 待真实需求 | 产物身份 + 记录冻结 + 只读归因；U0 后只考虑不可变 revision、任务钉住与固定 A/B 分流，不热改进行中训练 |
| [管线五阶段收敛 + Job/API 进程分离](pipeline-and-job-separation.md) | 待评审（**高优先级**） | 五阶段显式化（删中间件协议/驱动器/空阶段与双份驱动）+ 持久化 `jobs` 表（SKIP LOCKED 认领、租约心跳、退避）+ api/worker 同镜像不同角色；含内存实测与切换回滚路径 |
| [语音对答（对标豆包 / GPT 打电话模式）技术评估](voice-dialogue-realtime-options.md) | 论证文档（非决策） | 类豆包语音对答可行且成本低；保评分/情绪/病例命脉时方案 C（音频前装 + DeepSeek 文本脑）是唯一正确路线；真实 PSTN 不做 |
| [临床推理文字模拟 MVP-B 实施 brief](clinical_reasoning_simulation_mvp_b_implementation_brief.md) | **已冻结（历史设计稿，非实施指令）** | 时间资源/时间锚点/检查资源、可见性最小模型、CBC 生命周期等机制已在**实验模块** `backend/modules/simulations/**` 落地；**不进入正式训练闭环**，本轮不做独立学生端/第二条 workflow，去向见 [docs/18](../18-clinical-reasoning-disposition.md) |
