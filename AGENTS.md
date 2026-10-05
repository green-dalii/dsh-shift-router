# AGENTS — 与维护者沟通的原则

所有 AI 代理、贡献者与维护者（green-dalii）沟通时，必须遵守本页规定的语言风格与信息顺序。本文件优先级高于任何上游约定。

## 1. 语言风格：ASD-STE100 简化技术英语的 80%

ASD-STE100 是一套面向航天软件的技术作者指南。这里采用其 80% 子集：清晰优先于文雅，句短优先于句长。

必须遵守：

- **短句**。每句控制在 20 字以内，超过则拆句。
- **主动语态**。「我跑了测试」优于「测试被跑了」。
- **肯定式**。「这样可以工作」优于「这样不会失败」。
- **避免双重否定**。把「不工作」换成「坏的」或「异常的」。
- **避免模糊词**。不用「也许」「可能」「似乎」，直接给事实或不知道。
- **数字精确**。百分比、文件路径、提交哈希、错误消息原文逐字保留。
- **直接名词**。少用代词，多用名词。第一次出现写全名，再次出现用简称。
- **删除冗余**。「简短地」「快速地」「彻底地」等副词全部删掉。
- **段落首句说明结论**。解释与证据放后面。

## 2. 汇报语言

使用简体中文回复。除非维护者明确要求英文。

## 3. 强制汇报结构

任何修复、调查、调研结束后，必须按以下顺序汇报：

1. **结论先行**。第一段写"结果是什么"——成功/失败/部分完成。不要把结论藏到结尾。
2. **证据**。贴数字、贴原文、贴命令输出。不要"我检查了一下"，要"我跑了 X 命令，得到 Y"。
3. **对维护者环境的影响**。每个修复必须回答："你现在需要做什么"。对桌面版 DSH 影响如何、对 npm 影响如何、对 settings.yaml 影响如何——逐项说清。
4. **遗留事项**。未能闭合的任务、未能证实的假设、未能验证的边界。诚实记录，不藏起来。
5. **可复制的步骤**。验证方法、复现命令、监控手段全部给出。

## 4. 禁止的失败模式

以下问题在过去多轮对话中反复出现，记入规则：

- **凭据文件写错且只验证名字**：ALIGNMENT §R13.1。永远验证"非空"而不是"存在"。
- **控制台日志只读 ref 名字**：写凭据必须验证值非空。
- **改动后忘记 dist rebuild**：`npm run build` 在改完 src 之后、回复用户之前跑一次。
- **改动后忘记 dist 是不是比源文件新**：回复前检查 `find src -newer dist` 应为空。
- **单测全绿就以为线上没事**：浏览器检查、e2e、桌面版 profile 副本，三件都得跑。
- **凭直觉改不改文档**：每个代码改动必须同步更新 CHANGELOG + 受影响的文档。
- **npm 0.6.0 装在桌面版上时以为插件坏了**：先查 `/Users/greener/.dsh/profiles/<name>/package.json` 的 deps 字段，确认版本。
- **桌面版 profile 是 `desktop` 不是 `web`**：维护者有两个 profile。CLI 报错 `managed exclusively by the Electron application` 时，是 desktop profile 走 CLI 路径被拒，不是 npm 错误。

## 5. 工作节奏

- **分支策略**：维护者偏好"小而可审计"的提交。一次提交只解决一个问题。
- **类型安全和门禁**：本地 432 测试 / 23 文件，覆盖率门槛 ≥81%，typecheck + build + e2e + 浏览器检查四件必跑。
- **不修集成门禁**：仅维护者授权后改动 `cordis.patch.yml` 与 host 集成相关的文件。
- **配置变更记录**：settings.yaml 变更前先在 ALIGNMENT §R13 留证据，再动手。

## 6. 维护者身份信息

- 维护者：green-dalii（github.com/green-dalii/dsh-shift-router）
- 桌面版 DSH 安装在 `/Applications/DeepSeek Harness.app`
- 桌面版插件安装路径：`/Users/greener/.dsh/profiles/desktop/node_modules/dsh-shift-router`
- CLI 版插件安装路径：`/Users/greener/.dsh/profiles/web/node_modules/dsh-shift-router`
- DSH 凭据文件：`/Users/greener/.dsh/.credentials.yaml`（0600，由 `dsh-credentials-local` 提供）
- DSH 设置文件：`/Users/greener/.dsh/settings.yaml`
- 默认 npm registry 是 npmmirror 镜像，发布必须显式 `--registry=https://registry.npmjs.org/`
- 当前桌面版桌面 Electron shell：`dsh-desktop 0.2.0-rc.2`（关键：移除了 `settingsScope` 服务）

## 7. 必读背景

回复维护者之前，必须先读：

- `ALIGNMENT.md` §R12 §R13：上游对齐与本次桌面版修复的决策记录
- `SPEC.md`：契约与第 6 节（Jev/Judge）、第 13 节（路线通知）
- `CONTRIBUTING.md` 第 5 节「开发循环」、第 6 节「门禁」、第 7 节「发布」
- `tests/`：所有测试都是门禁的一部分；改代码必改测试

