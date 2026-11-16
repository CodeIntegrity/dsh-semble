# dsh-semble 现状审计

> 基线：v3.0.6 工作区，2026-11-13。`npm test` 64/64 通过（Windows 本机），`npm run typecheck` 清洁。
> 本文件取代 2.2.0 时代（commit `8cd3045`，2026-10-23）的审计。旧版问题清单已基本关闭，架构在
> 3.0.0 从 MCP 桥换成原生工具，旧文档描述的 MCP 装配方式已不存在。

## 一、现状

- **架构**：`cordis.patch.yml` 只有一个锚点行（`name: 'dsh-semble'`），`lib/index.js` 经
  `ctx.inject(['tools'])` 注册原生工具 `semble_search` / `semble_find_related`，经
  `ctx.inject(['commands'])` 注册 `/semble`。每次调用 spawn 一次
  `uvx --from "semble[mcp]" semble <subcommand> ... --format json`，没有常驻进程。
- **依赖与构建**：零 npm 运行时依赖，无构建步骤，纯 ESM；唯一外部依赖是 PATH 上的 `uv`。
- **代码量**：`lib/` 约 1.2k 行（`index.js` 插件装配 243 行、`cli.js` 进程运行、`tools.js` 工具与解析）。
- **测试**：64 例，`node --test`；`.github/workflows/ci.yml` 在 push main 与每个 PR 上跑
  ubuntu / windows / macos 矩阵，另有一个 typecheck job。
- **平台敏感路径**：临时文件捕获（pipe 会被沙箱 EPERM，见 `lib/cli.js` 头注释）、进程树终止、
  UTF-8 字节截断边界。
- **版本策略**：浮动 spec `semble[mcp]`，跟随 PyPI 最新版；pin 方法写在 `cordis.patch.yml` 注释里。

## 二、2.2.0 审计问题处置

| # | 问题（2.2.0 基线） | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 无 push/PR CI，测试仅发布 tag 时、仅 ubuntu | 已修 | `.github/workflows/ci.yml` 三平台矩阵 + typecheck |
| 2 | 截断按 UTF-16 码元计数，且全量读入后才截断 | 已修 | `readCapped` / `decodeUtf8Prefix`；截断与多字节边界两用例 |
| 3 | `handleSembleCommand` 不可注入，四个文案分支零覆盖 | 已修 | `handleSembleCommand(invocation, options)`；`test/index.test.js` 分支用例 |
| 4 | Windows `.cmd` shim 启动失败不指向 workaround | 已修 | `lib/index.js` cannot-start 文案、`lib/tools.js` `parseOrThrow` |
| 5 | 子进程事件回调内同步 FS 无异常兜底 | 已修 | `closeQuietly` / `removeDir` |
| 6 | 启动命令双份定义，无一致性校验 | 已修 | `test/consistency.test.js` 断言 prefix 与 patch yml 逐项相等 |
| 7 | 测试盲区：截断、双流合并、env 透传、frontmatter | 已修 | `test/cli.test.js`、`test/index.test.js` 对应用例 |
| 8 | 文档漂移（README 版本、docblock 计数、JSDoc 缺字段） | 已修 | — |
| 9 | exports 缺 `./package.json` | 已修 | `package.json` 的 `exports` |
| 10 | 浮动 spec 的供应链暴露 | 保留 | 知情权衡，见第四节 |
| 11 | 子进程继承宿主全量环境 | 保留 | 知情权衡，`SEMBLE_*` 依赖这一行为 |
| 12 | 宿主线程上的同步 FS | 保留 | 每次调用一次、KB 级，影响可忽略 |
| 13 | `assets/icon-180.png` 不入 npm 包 | 保留 | 商店/仓库展示用 |

## 三、当前问题

### 3.1 进程治理（本版已修大半）

超时与中止现在都走同一条链路：`SIGTERM` → 2 s → `SIGKILL`，这两条信号在 POSIX 上发给子进程
**所在的进程组**（`spawn` 时 `detached: true`，杀时 `process.kill(-pid, ...)`），所以 `uvx` 拉起的
python worker 会一起死，而不是只杀壳。`kill` 返回 `false` 时立即补一发 `SIGKILL`；如果再 5 s
`close` 仍不来，watchdog 直接结算，保证信号量槽位与临时目录不会泄漏（此前一次卡死会永久占掉两个
并发名额之一）。

仍然存在：

- **Windows 没有进程组信号**，`taskkill /T` 需要再 spawn 一个进程，代价与风险都不值，所以那里只
  终止直系子进程。代码内以 `shortcut:` 注释标明该边界。
- **升级定时器仍是 `.unref()` 的**：宿主事件循环空掉时那一发 SIGKILL 不一定开出。此时宿主自身已在
  退出，影响只剩"可能留下孤儿"，不再是"卡住调用"。
- **watchdog 保证的是结算，不是死亡**：进程若被 OS 拒绝杀死，调用会返回但进程仍在。

### 3.2 进程树未在 CI 上真实验证

CI 已跑三平台，但测试里的子进程是 `process.execPath` 替身，`uvx → python` 这条真实父子链一次都没
进过测试。Windows 的终止语义（`TerminateProcess`）只能真机验证，回归仍要靠人工冒烟。

### 3.3 并发上限（已可配置）

默认仍是 `DEFAULT_MAX_CONCURRENT = 2`（上游 `SEMBLE_INDEX_WORKERS` 默认 4，两路冷启动最坏 8 个
分块 worker），但 `maxConcurrent` 现在是可校验的插件设置：`runSemble` 按不同上限复用独立信号量，
工具和 `/semble` 共用同一份设置。

### 3.4 已知权衡

- 浮动 spec：上游 0.x，每个新版本自动生效；pin 方法已文档化。
- 全量 env 继承：子进程可见宿主所有环境变量，换取 `SEMBLE_*` 与 `HF_ENDPOINT` 的零配置透传。
- 同步 FS 在宿主线程：量级可忽略。

## 四、明确不做

1. **TypeScript 全迁移**——引入构建步骤会破坏"无构建 + `link:` 改完即生效"；JSDoc + `checkJs`
   已拿到类型检查。
2. **打包/转译工具**——零依赖纯 ESM 是本包供应链面最小的直接原因。
3. **进一步模块化拆分**——装配 / 进程 / 工具三文件的切分已经是最小合理粒度。
4. **默认硬 pin 上游版本**——自动跟进上游修复是设计价值；pin 决策留给操作者。

## 五、假设

- A1：Node 对 `.cmd`/`.bat` 的无 shell spawn 抛 EINVAL（CVE-2024-27980 缓解），未实测。
- A2：uv 的 `--from` 接受 PEP 508 约束——**已证伪为真**：`semble[mcp]>=0.7` 实测解析到 0.7.x。
- A3：`assets/icon-180.png` 仅供商店/仓库展示。
- A4：DSH 按 loader 条目名匹配包名判定"已加载"。
- A5：Node 24.9 `--experimental-test-coverage` 输出可直接作 CI 基线（未启用）；CI 与发布已切到 24.9。

## 六、上游与发布

- 上游复核（2026-11-11）：`semble` 0.7.3，`search`/`find-related` 的 JSON 结构与 CLI 标志无破坏性
  变更；3.0.5 起本包解析其顶层 `repos` 映射并在输出里列出 `Sources:`。
- 发布：`npm version minor` → `git push origin main --follow-tags`；`publish.yml` 校验 tag 与
  `package.json` 一致、测试、幂等检查、`npm publish --provenance`。
