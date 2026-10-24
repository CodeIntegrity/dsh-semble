# dsh-semble 升级方案

> 基线：commit `8cd3045`（v2.2.0），撰写日期 2026-10-23。测试基线：`node --test` 13/13 通过（Windows 本机）。
> 所有判断均附文件与行号依据；无法从代码或公开信息确证的推断以 **[假设]** 标注。

> **执行状态（2026-10-24，基线 8cd3045 → 2.3.0）**：阶段 0/1/2 全部完成，阶段 3 完成 `/semble version`。
> 已落地：`readCapped` 真字节截断 + 事件回调兜底（a5ec071）；`/semble version` 与 cannot-start 四行指引（c5676b3）；测试扩至 23/23，新增 `test/consistency.test.js` 守护 patch yml 与 `SEMBLE_UVX_PREFIX` 一致（1cdf1c6）；strict `checkJs` 类型契约 + `npm run typecheck` + `./package.json` 导出（4425756）；三平台 push/PR CI（25521b9）；README 双语版本示例、新增「兼容性」小节、Development 补 typecheck。
> 未做（按原计划排除）：env 白名单、默认版本下限、TS 全迁移、构建工具、模块化再拆分、默认硬 pin。
> 假设复核：**A2 已证伪**——实测 `uvx --from 'semble[mcp]>=0.7' semble --version` 输出 0.7.0，uv 支持 PEP 508 约束（但默认策略仍保留浮动 spec）；A1/A3/A4/A5 维持原状。

## 结论（TL;DR）

**这是一个小而健康的代码库（lib 共 372 行、零 npm 运行时依赖、无构建步骤、13 个测试全绿），真正的短板不在代码质量，而在工程保障**：没有任何 push/PR 级 CI（测试只在打 tag 发布时跑、且仅 ubuntu），README 宣称的三平台支持从未被 CI 验证；其次是个别健壮性细节（输出截断按 UTF-16 码元计数而非字节、事件回调内的同步文件操作缺异常兜底）与少量文档漂移。

建议的投入排序：

1. **阶段 0 + 阶段 1（合计约 1.5 人日）** —— 修掉全部 P1/P2 问题：三平台 CI 矩阵、`readCapped` 字节上限修复、`handleSembleCommand` 可测试化重构与分支测试补全、文档修正。收益立竿见影。
2. **阶段 2（约 1 人日，可选）** —— JSDoc 类型补全 + `tsc --noEmit`（`checkJs`），在不引入构建步骤的前提下获得类型检查。
3. **阶段 3（按需）** —— `/semble version` 诊断子命令、上游版本下限策略等增强。
4. **明确不做** —— TypeScript 全迁移、引入构建工具、进一步模块化拆分、默认硬 pin 上游版本。理由见第四节。

---

## 一、代码库现状概览

### 1.1 项目定位

`dsh-semble` 是一个 DeepSeek Harness（DSH）插件 bundle，把 [MinishLab/semble](https://github.com/MinishLab/semble)（Python 写的语义代码检索引擎）以 MCP 服务器的形式桥接进 DSH 会话。**本包不含任何检索逻辑**：真正的搜索由 PyPI 上的 `semble[mcp]` 经 `uvx` 启动的子进程完成（`cordis.patch.yml:1-7`），本包只做三件事——装载锚点、注册路由 skill、提供 `/semble` 报表命令（`lib/index.js:4-23`）。

### 1.2 目录结构

| 路径 | 行数 | 职责 |
| --- | --- | --- |
| `lib/index.js` | 151 | 插件入口：默认导出 `sembleMcpBundle(ctx)` + 具名 `apply`；注册 skill、`/semble` 命令 |
| `lib/cli.js` | 221 | CLI 运行器：参数 allow-list 解析、spawn `uvx`、临时文件捕获输出、超时/中止处理 |
| `cordis.patch.yml` | 55 | 装配文件：插入 2 个 loader 行（锚点行 + `@deepseek-ai/dsh-mcp-client` MCP 行） |
| `skills/semble/SKILL.md` | 67 | 路由 skill 正文（何时用语义搜索、查询技巧、成本与回退） |
| `locale/en.json` / `locale/zh.json` | 6+6 | DSH 插件中心的双语元数据 |
| `test/index.test.js` | 59 | 入口行为：usage/未知子命令/skill 与命令注册 |
| `test/cli.test.js` | 85 | CLI 运行器：解析、成功/失败/缺失可执行/超时/中止 |
| `.github/workflows/publish.yml` | 100 | tag 驱动的 npm 发布流水线 |
| `assets/icon-180.png` | — | 商店图标（见 P3-13 的假设） |

### 1.3 入口与公开 API

- **npm exports**（`package.json:32-36`）：`.` → `lib/index.js`；`./locale/*.json`；`./icon` → `icon.svg`。
- **插件 API**：默认导出 `sembleMcpBundle(ctx)` 与 `export const apply`（`lib/index.js:120,151`），二者同体；loader 任取其一。
- **模块级导出**（`lib/cli.js`）：`parseSembleArgs`、`runSemble`、`SEMBLE_USAGE`、`SEMBLE_UVX_PREFIX`、`DEFAULT_TIMEOUT_MS`（60s）、`CAPTURE_LIMIT_BYTES`（256KB）；（`lib/index.js`）：`handleSembleCommand`、`name`、`inject`。
- **运行时工具面**（由上游 MCP 服务器提供，本包只负责装载）：`mcp__semble__search`、`mcp__semble__find_related`。
- **命令面**：`/semble savings`、`/semble file-types`（allow-list 定义于 `lib/cli.js:36-39`，刻意排除破坏性子命令如 `clear`，`lib/cli.js:14-17`）。

### 1.4 对外暴露的配置项

操作者可改的全部开关都在 `cordis.patch.yml` 的 MCP 行（`semble-mcp` row）里，README.md:124-137 有完整表格：`args`（含版本 pin 写法）、`env`（`HF_ENDPOINT`、`SEMBLE_*`）、`toolCallTimeoutMs`（默认 300000，`cordis.patch.yml:45`）、`cwd`、`command`。另有 6 个 `SEMBLE_*` 环境变量（README.md:146-153）。**刻意不设默认值的设计**（无 OS 路径、无区域端点、不设 env/cwd）见 `cordis.patch.yml:9-14,46-55`——这是本包跨平台零配置的根基，任何升级都应保留。

### 1.5 依赖与构建

- **运行时 npm 依赖：0 个**。唯一外部依赖是 PATH 上的 `uv`（`package.json` 无 dependencies 字段；`engines`: node>=22, dsh>=0.2.1-rc.2，`package.json:10-13`）。供应链面极小。
- **无构建步骤**：`lib/` 是纯 ESM 直接发布，README.md:305 将此列为特性（`link:` 开发安装无需构建）。
- **上游版本策略**：浮动 spec `semble[mcp]`（`cordis.patch.yml:36`），跟随 PyPI 最新版；pin 方法已文档化（`cordis.patch.yml:16-18`）。
- **CI Actions**：`actions/checkout@v4`、`actions/setup-node@v4`（`.github/workflows/publish.yml:34,36`）——均为当前主版本，无需升级。

### 1.6 测试现状

`node --test` 原生 runner，13 用例全绿（本机 Windows 验证）。已覆盖：参数解析全分支（`test/cli.test.js:9-35`）、spawn 成功/非零退出/可执行缺失/超时/中止（`test/cli.test.js:37-84`，用 Node 二进制替换 uvx，不触网）、usage 与未知子命令（`test/index.test.js:6-18`）、skill/命令注册与无命令面降级（`test/index.test.js:20-58`）。

**未覆盖**（详见 P2-3、P2-7）：输出截断分支、`handleSembleCommand` 对 error/timeout/非零退出的文案映射、`stripFrontmatter` 的各分支断言、env 透传。

### 1.7 发布链路

tag 驱动（`v*`）：校验 tag 与 package.json 一致（`publish.yml:48-58`）→ 测试（:60-61）→ 幂等检查（:63-73）→ `npm publish --provenance`（:79-85）。registry 实况：2.0.0 / 2.1.0 / 2.2.0 已发布，latest = 2.2.0 与本地一致（npm registry 查询，2026-10-23）。

---

## 二、问题清单（按严重程度排序）

严重程度分级：**P1** = 影响可靠性/平台承诺，应尽快修；**P2** = 健壮性、可测试性与文档缺陷，随下个版本修；**P3** = 已声明的设计权衡或影响极小的观察项，记录在案即可。

| # | 级别 | 问题 | 位置 |
| --- | --- | --- | --- |
| 1 | P1 | 无 push/PR CI；测试仅在发布 tag 时运行且仅 ubuntu 单平台 | `.github/workflows/publish.yml:11-14,33,60-61` |
| 2 | P1 | 输出截断上限按 UTF-16 码元而非字节计数，且全量读取后才截断 | `lib/cli.js:31,198-206` |
| 3 | P2 | `handleSembleCommand` 无法注入 runner，三个用户可见分支零覆盖 | `lib/index.js:75-97` |
| 4 | P2 | Windows `.cmd` shim 启动失败的报错不指向已有 workaround | `lib/index.js:78-83`、README.md:135 |
| 5 | P2 | 子进程事件回调内的同步 FS 操作缺异常兜底，异常会升级为 uncaughtException | `lib/cli.js:115-123,180-184` |
| 6 | P2 | `SEMBLE_UVX_PREFIX` 与 patch yml 双份定义，无一致性测试 | `lib/cli.js:25` vs `cordis.patch.yml:34-37` |
| 7 | P2 | 测试盲区：截断、双流合并、env 透传、frontmatter 剥离断言 | `test/cli.test.js`、`test/index.test.js` |
| 8 | P2 | 文档漂移：README 示例版本过时、docblock 计数错误、JSDoc 缺字段 | 见详情 |
| 9 | P2 | exports 未暴露 `./package.json` | `package.json:32-36` |
| 10 | P3 | 浮动 spec 的供应链暴露（上游 0.x 阶段） | `cordis.patch.yml:36` |
| 11 | P3 | `/semble` 子进程继承宿主全量环境变量 | `lib/cli.js:99-101` |
| 12 | P3 | 宿主线程上的同步 FS（量级极小） | `lib/cli.js:163-175,198-206` |
| 13 | P3 | `assets/icon-180.png` 不入 npm 包且无代码引用 | `package.json:37-46` |

### P1-1 无 push/PR CI，且从不验证 Windows/macOS

`.github/workflows/publish.yml:11-14` 的触发器只有 `tags: v*` 与 `workflow_dispatch`——**main 分支的普通 push 和 PR 不跑任何检查**。`Test` 步骤（:60-61）在 `runs-on: ubuntu-latest`（:33）单平台执行。而 README.md:210-220 明确承诺三平台支持，且代码里平台敏感逻辑恰恰集中在被测最少的路径上：临时文件捕获（`lib/cli.js:162-195`，为绕开沙箱命名管道的 EPERM 而设计，`lib/cli.js:9-12`）、Windows 下的进程树终止行为（SIGTERM→SIGKILL 升级，`lib/cli.js:125-130`）。这些逻辑在 ubuntu 上跑绿不等于在 Windows 上正确。**后果**：回归只能在发布时刻（甚至发布后）被发现。

### P1-2 `readCapped` 的字节上限名不副实

`CAPTURE_LIMIT_BYTES = 256 * 1024` 名为"字节"（`lib/cli.js:31`），但 `readCapped`（:198-206）先 `readFileSync(path, 'utf8')` **整读文件成字符串**，再用 `text.length > CAPTURE_LIMIT_BYTES` 截断——`String.length` 数的是 UTF-16 码元。两个后果：

1. **语义失真**：含 CJK/emoji 的输出，256K 码元最多对应约 768KB 字节，注释宣称的"a cap keeps a runaway child from filling the transcript"（:30）在字节数维度不成立。
2. **读取不受限**：截断发生在整读之后。一个失控子进程写出的 GB 级文件会被完整读进宿主内存后才截断——上限只约束返回字符串，不约束读取本身。`statSync(path).size`（:200）已经拿到了文件大小，却只用于零文件快速路径，没有用于预截断。

触发条件苛刻（子进程须先失控再海量输出），故列为 P1 下限/ P2 上限的边界问题，但修复成本极低（见阶段 0）。

### P2-3 `handleSembleCommand` 不可注入 runner

`lib/index.js:75` 直接调用 `runSemble(parsed.argv, { signal })`，`command`/`timeoutMs`/`prefix` 无法从外部替换。结果是该函数四个用户可见分支（:78-83 启动失败文案、:84-86 中止、:87-92 超时文案、:93-98 非零退出文案）**零测试覆盖**——测试只能经 `runSemble` 层间接验证 spawn 机制，验证不了文案映射逻辑本身。`runSemble` 的 options 参数（`lib/cli.js:72`）本来就是为注入设计的，入口层没有接上。

### P2-4 Windows `.cmd` shim 的失败指引不足

Node ≥18.20/20.12/21.7 起，无 `shell: true` 的 `spawn` 遇到 `.cmd`/`.bat` 直接抛 EINVAL（CVE-2024-27980 的缓解措施）。winget 安装的 uv 提供 `uvx.exe`（spawn 可用），但 pip/npm shim 等安装方式可能只提供 `uvx.cmd`。README.md:135 已文档化 workaround（把 `command` 指到 `uvx.exe`），但用户实际看到的报错（`lib/index.js:78-83`）只说"Install uv first"并给 uv 安装链接——**对已经装了 uv 的用户这是误导**。**[假设]** EINVAL-on-.cmd 行为基于 Node 安全补丁的公开资料，未在本文档撰写时实测复现。

### P2-5 事件回调内的同步 FS 异常未兜底

`finish()`（`lib/cli.js:115-123`）在 `child.on('close')` / `on('error')` 回调中执行 `capture.collect()`，后者裸调 `closeSync` 两次（:181-182）。若 `closeSync` 抛出（EBADF 等），异常发生在事件回调里，将升级为进程级 uncaughtException——而宿主是整个 DSH。概率极低（关闭刚打开的合法 fd 很少失败），但影响面是整个宿主进程，兜底只需一个 try/catch。

### P2-6 启动命令双份定义，无机器校验

`SEMBLE_UVX_PREFIX = ['--from', 'semble[mcp]', 'semble']`（`lib/cli.js:25`）与 `cordis.patch.yml:33-37` 的 `command/args` 必须保持一致（`lib/cli.js:24` 注释明言"kept identical so both share one install"），否则 `/semble` 与 MCP 服务器会落到两份不同的 uv 安装。当前只有人工约定，没有测试断言两处一致——改其一忘其二时无任何报警。

### P2-7 测试盲区汇总

- 截断分支：无 >256KB 输出用例（`readCapped` 的截断与 TRUNCATED 标记从未被执行过）；
- 双流合并：`lib/index.js:76` 的 stdout+stderr 拼接无用例；
- env 透传：`runSemble` 的 `env` 选项（`lib/cli.js:81,101`）无用例；
- frontmatter：`stripFrontmatter`（`lib/index.js:41-44`）无分支断言（可加一条"注册的 skill content 不以 `---` 开头"）。

### P2-8 文档漂移

- README.md:74、:264、:268 与 README.zh-CN.md:64、:240、:244 示例版本仍是 `2.1.0`（含 `#v2.1.0` tag 引用），当前已是 2.2.0；
- `lib/index.js:4` docblock 写"Two responsibilities"，下面列了 **3** 条（:6-23）；
- `runSemble` 的 JSDoc 返回类型（`lib/cli.js:73`）缺 `signal` 字段，实际由 :149 展开。

### P2-9 exports 缺 `./package.json`

`package.json:32-36` 的 exports map 未包含 `./package.json`。部分工具链（版本读取器、诊断脚本）会因此拿到 ERR_PACKAGE_PATH_NOT_EXPORTED。一行修复。

### P3-10 浮动 spec 的供应链暴露（已声明的设计权衡）

`cordis.patch.yml:36` 使用浮动 `'semble[mcp]'`，上游每个新版本（含破坏性变更）都会在下次服务器启动时自动生效。上游现状：PyPI 最新 **0.7.0**（2026-04 首发 0.0.1，半年内 20+ 个版本，仍处 0.x）——按语义化版本惯例 0.x 阶段不承诺兼容。README.md:255-257 已声明该策略（"only a breaking change to the CLI surface would need an edit here"），`cordis.patch.yml:16-18` 给出 pin 方法。**这是知情权衡而非疏忽**，故列 P3；可选缓解（版本下限）见阶段 3。

### P3-11 子进程继承宿主全量环境（刻意的）

`lib/cli.js:101` 将 `...process.env` 整体传给子进程，注释（:99-100）说明是为让 `SEMBLE_*` 调优生效，README.md:141-144 还依赖这一行为解释 `/semble` 与 MCP 行的环境差异。副作用是 CLI 子进程可见宿主的全部环境变量（含可能存在的凭据）。本地只读报表工具，风险有限；若要收紧见阶段 3（需权衡破坏 `SEMBLE_*` 透传）。

### P3-12 宿主线程上的同步 FS

`mkdtempSync/openSync/readFileSync/rmSync`（`lib/cli.js:163-175,198-206`）都是同步调用，执行在 DSH 宿主主线程。每次 `/semble` 一次、量级 KB 级，实际影响可忽略，列出仅为完整性。

### P3-13 `assets/icon-180.png` 疑似遗留

不在 `files`（`package.json:37-46`）里，代码与配置均无引用。**[假设]** 仅供插件商店/仓库展示用，无需随 npm 包分发；若确认无用可移除以免误导。

---

## 三、升级方向评估（成本/收益）

| 方向 | 成本 | 收益 | 结论 |
| --- | --- | --- | --- |
| TypeScript 全迁移 | 高：引入 tsc/tsup 构建步骤，直接破坏"无构建"特性（README.md:305）与 `link:` 开发安装流程 | 低：372 行、无外部类型消费者 | **不推荐** |
| JSDoc 类型补全 + `tsc --noEmit --checkJs` | 低：devDependency 仅 typescript，CI 加一步，产物零变化 | 中：ctx/结果类型约束、IDE 补全，捕获 P2-5 类低级错误 | **推荐**（阶段 2） |
| npm 依赖更新 | — | — | 无对象：运行时依赖为 0；CI actions 已是 v4 当前主版本 |
| 构建工具现代化（引入打包器/linter 管线） | 中 | 负：为 372 行无构建代码引入构建是倒退 | **不推荐**（仅可选 eslint，阶段 2 附带） |
| 模块化拆分 | 中 | 负：已是两文件最小合理结构，再拆是过度设计 | **不推荐** |
| API 兼容层 | 低 | 中：对外面只有 `/semble` 命令 + npm exports；写明 semver 承诺即可防误用 | **推荐**（阶段 2 文档化） |
| CI 三平台矩阵 + push/PR 工作流 | 低 | 高：兑现平台承诺、回归前置 | **强烈推荐**（阶段 1，P1-1） |
| 上游版本下限策略 | 低 | 中：缓解 P3-10 而不放弃自动跟进 | **可选**（阶段 3） |

补充：`@deepseek-ai/dsh-mcp-client` 由 DSH 宿主解析（本包仅在 patch yml 中按名引用，不安装、不 pin），其 0.0.1-rc.1 / 0.2.1-rc.3 的版本动荡（npm dist-tags，2026-10-23 查询）不影响本包，无需行动。

---

## 四、升级路线图

### 阶段 0 —— 快赢修补（约 0.5 人日）

**目标**：消除全部 P2 代码/文档问题与 P1-2，不动架构。

改动点：
1. `lib/cli.js:198-206` `readCapped` 改为真字节上限：用已有的 `statSync(path).size` 预判，超限时以 `Buffer` 读前 `CAPTURE_LIMIT_BYTES` 字节再按 utf8 解码（注意从码元边界回退避免截出半个字符），保留 TRUNCATED 标记。
2. `lib/cli.js:115-123` `finish()` 内 `capture.collect()` 包 try/catch，异常退化为空输出 + error 字段（P2-5）。
3. `lib/index.js:75` 给 `handleSembleCommand` 增加可选第二参 `overrides` 透传 `runSemble` options（保持单参调用不变，向后兼容），为阶段 1 测试铺路（P2-3 的机制部分）。
4. `lib/index.js:78-83` 启动失败文案补一句：Windows 上若 uv 是 `.cmd` shim，请在插件设置把 `command` 指向 `uvx.exe`（指向 README Settings 表）（P2-4）。
5. `package.json` exports 增加 `"./package.json": "./package.json"`（P2-9）。
6. 新增 `test/consistency.test.js`：读取 `cordis.patch.yml` 文本，断言其中 `args` 与 `SEMBBLE_UVX_PREFIX` 逐项一致（P2-6；零依赖，按行文本断言即可）。
7. 文档修正（P2-8）：README.md:74/264/268、README.zh-CN.md:64/240/244 的 `2.1.0`→`2.2.0`；`lib/index.js:4` "Two"→"Three"；`lib/cli.js:73` JSDoc 补 `signal?: string`。

风险：低。全部是局部行为收紧或文档；`readCapped` 改动是唯一行为变化（截断点更保守）。
验证方式：`npm test` 全绿；新增截断用例（构造 >256KB stdout）与一致性用例通过；`npm pack --dry-run` 确认包内容除新增测试外不变。

### 阶段 1 —— 工程保障（约 1 人日）

**目标**：兑现平台承诺，补齐入口层测试（P1-1、P2-3、P2-7）。

改动点：
1. 新增 `.github/workflows/ci.yml`：`on: push`（main）+ `pull_request`；矩阵 `os: [ubuntu-latest, windows-latest, macos-latest]` × `node: [22]`；步骤 `npm test`。发布工作流保持不变（它自带测试与幂等检查）。
2. `test/index.test.js` 补 `handleSembleCommand` 分支用例（借助阶段 0 的注入参数）：注入 `process.execPath` + `-e` 脚本分别覆盖启动失败文案、超时文案、非零退出文案、stdout+stderr 合并。
3. `test/cli.test.js` 补：截断用例（`'x'.repeat(300*1024)` 输出）、`env` 透传用例（子进程打印 `process.env.PROBE` 断言回读）。
4. `test/index.test.js` 补：注册的 skill `content` 不以 `---` 开头（frontmatter 已剥离）。
5. （可选）`npm test` 改为 `node --test --experimental-test-coverage`，在 CI 输出行覆盖率基线。**[假设]** Node 22 的覆盖率标志输出满足需求；若噪音大可跳过。

风险：低-中。Windows CI 首跑可能暴露真问题（这恰是目的）：预判最可能的失败点是 `runSemble` 超时用例在 Windows 慢 runner 上的时序（200ms 阈值偏紧，可放宽到 500ms 并断言 `timedOut` 而非精确时长）。
验证方式：三平台矩阵全绿；本地 `npm test` 保持全绿；PR 上能看到覆盖率输出（若启用）。

### 阶段 2 —— 类型与契约（约 1 人日，可选）

**目标**：零构建前提下获得类型检查与明确的兼容承诺。

改动点：
1. 新增 `tsconfig.json`（`checkJs: true`、`noEmit: true`、`strict` 或先 `strictJS` 渐进），为 `lib/` 补全 JSDoc 类型：`ctx`（skills/commands/inject 服务形状）、`parseSembleArgs` 判别联合返回、`runSemble` 结果类型（含此前遗漏的 `signal`）。
2. devDependency 增加 `typescript`（devDependencies 目前不存在，新建），`package.json` scripts 增加 `"typecheck": "tsc --noEmit"`，CI 增加该步骤。**注意**：`files` 不含 tsconfig/类型声明需评估是否发布 `lib/*.d.ts`——首版建议**不发布**（无外部类型消费者），保持产物零变化。
3. README 增补一小节《兼容性承诺》：npm exports 与 `/semble` 命令面遵循 semver；`lib/` 内部导出视为内部 API，次版本可能变动。**[假设]** @deepseek-ai 侧存在可引用的宿主类型包；若不存在，`ctx` 类型以本地 interface 自行声明即可，成本不变。

风险：低。`checkJs` 可能暴露若干隐式 any 报错，属预期收益而非风险；注意不要为了消警告把 JSDoc 写得比代码还长。
验证方式：`npm run typecheck` 清洁；`npm pack --dry-run` 产物与阶段 1 完全一致（零新增发布文件）；三平台 CI 绿。

### 阶段 3 —— 按需增强（各自独立，不设时限）

以下各项独立可选，均需先有阶段 1 的 CI 兜底：

| 增强项 | 改动点 | 风险 | 验证 |
| --- | --- | --- | --- |
| `/semble version` 诊断子命令 | `lib/cli.js:36-39` allow-list 加 `['--version']`；usage 文案同步 | 极低（只读）；README.md:290 排障表已让用户手敲该命令，命令化是纯增益 | 新用例 + 真机 `/semble version` |
| 上游版本下限 | `cordis.patch.yml:36` 改 `'semble[mcp]>=0.7'` 形式 | **[假设]** uv 的 `--from` 支持 PEP 508 版本约束（未实测，先手工验证）；下限选择需跟进上游节奏 | `uvx --from 'semble[mcp]>=0.7' semble --version` 实测；MCP 工具冒烟 |
| env 白名单选项 | `runSemble` 增加可选 `envAllowlist`，默认维持现状 | 中：与 `SEMBLE_*` 透传（README.md:141-144）语义冲突，需产品决策 | 新用例覆盖默认与白名单两态 |
| 移除 `assets/icon-180.png` | 删除文件 | 无（确认 P3-13 假设后） | `npm pack --dry-run` 不变 |

### 各阶段完成定义（DoD）

- 阶段 0/1/2 均以一次 minor 版本发布收尾（`npm version minor` → tag → publish.yml 自动发布，README.md:311-330 流程）。
- 每阶段合并前：CI 三平台绿（阶段 1 起）、`npm pack --dry-run` 产物 diff 符合预期、真机冒烟（DSH 内 `mcp__semble__search` 一次调用 + `/semble savings` 一次）。

---

## 五、快速见效改进建议（Quick Wins）

按性价比排序，全部可独立提交：

1. **新增 `ci.yml` 三平台测试矩阵**（P1-1，~0.5h）——唯一能让"三平台支持"从口号变成回归测试的改动。
2. **`readCapped` 真字节截断**（P1-2，~0.5h）——顺带获得首个截断测试用例。
3. **一致性测试守护 `SEMBLE_UVX_PREFIX` ↔ patch yml**（P2-6，~0.5h）——杜绝"改一漏一"的隐性断裂。
4. **`handleSembleCommand` 注入化 + 分支测试**（P2-3，~1h）——四个用户可见文案从零覆盖到全覆盖。
5. **README 版本示例与 docblock 修正**（P2-8，~15min）——纯文档，零风险。
6. **exports 加 `./package.json`**（P2-9，~2min）。
7. **启动失败文案指向 `.cmd` workaround**（P2-4，~15min）——为已装 uv 的 Windows 用户省一次排障往返。

---

## 六、明确不建议的方向（及理由）

1. **TypeScript 全迁移**——372 行代码换不回一个构建步骤的成本；`link:` 开发安装（README.md:98-106）依赖"改完即生效"，构建步骤会破坏它。JSDoc + checkJs 以 1/5 成本拿到 80% 收益。
2. **引入打包/转译工具**——无依赖的纯 ESM 是本包供应链面最小的直接原因，打包只会增大它。
3. **进一步模块化拆分**——`index.js`（插件装配）/ `cli.js`（进程运行）的切分已经是最小合理粒度。
4. **默认硬 pin 上游版本**——自动跟进上游修复是 `cordis.patch.yml:4-7` 声明的核心价值；把 pin 决策留给操作者（已有文档支持）是对的。可选做版本下限，不做默认锁定。

---

## 附录：假设与信息来源

**假设清单**（正文以 **[假设]** 标注）：
- A1：Node 对 `.cmd`/`.bat` 的无 shell spawn 抛 EINVAL（P2-4），基于 CVE-2024-27980 缓解措施的公开资料，未实测。
- A2：uv 的 `--from` 接受 PEP 508 版本约束（阶段 3"版本下限"），未实测。
- A3：`assets/icon-180.png` 仅供商店/仓库展示（P3-13）。
- A4：DSH 按 loader 条目名匹配包名判定"已加载"（`lib/index.js:8-13` 注释所述），未读宿主源码核实。
- A5：Node 22 `--experimental-test-coverage` 输出可直接用作 CI 基线（阶段 1 可选项）。

**外部信息**（2026-10-23 查询）：
- PyPI `semble` 最新 0.7.0（2026-10-16 发布；2026-04-07 首发 0.0.1；Python >=3.10；`mcp` extra 依赖 `mcp>=2,<3`）：https://pypi.org/project/semble/
- npm `dsh-semble` 已发布 2.0.0/2.1.0/2.2.0，latest=2.2.0：https://www.npmjs.com/package/dsh-semble
- npm `@deepseek-ai/dsh-mcp-client` dist-tags：latest=0.0.1-rc.1，next=0.2.1-rc.3（由宿主解析，与本包无依赖关系）。
