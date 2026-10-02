# Locus 与 JamScript：基于 Best Head 的交易流水线实施方案

日期：2026-10-02
目标环境：MiniJAM Stage-1 测试网
覆盖范围：JamScript Backend、JamScript Client、Locus SDK 与 Web 前端、空投脚本
状态：供 Codex 按阶段实施的工程任务书

## 1. 目标与完成定义

当前体验中，用户提交一笔交易后，后续动作可能要等到 finalized 状态才继续。Stage-1 的 finalized 间隔约一分钟时，这会把链上确认时间直接放大成用户操作等待时间。我们需要让系统以 best head 组织读取、nonce 分配、提交和 UI 更新，同时保留 finalized 作为更强的最终确认。

目标体验：

1. 一个用户提交交易后，Backend 尽快返回可追踪的交易标识；其他用户可以立即继续提交，不等待前一笔 finalized。
2. 同一账户的多笔交易获得唯一且有序的 Ownership nonce；并发提交不能分配重复 nonce。
3. 应用状态和交易进度能够显示 best head 上的最新状态；UI 明确区分已进入 best chain 与 finalized。
4. 多笔独立交易可在合适时机一起进入 Work/package；每笔交易仍能独立追踪、显示结果和失败原因。
5. best chain 重组、提交超时、Backend 重启、交易失败等情况不会造成静默丢单或不安全的自动重放。
6. finalized 查询和 finalized 证明继续可用，不能把 best 状态伪装成最终确认。

完成标准不是“代码调用了 best API”，而是用户 A 的第一笔交易尚未 finalized 时，用户 B 仍能得到自己的交易 ID 并继续操作；若 B 的动作依赖 A 的状态，则界面解释依赖关系并在相应状态出现后继续，而不是全局等待 finalized。

## 2. 必须先查明的当前行为

不要先假设瓶颈只由“只有一个 Service”造成。单个 Service 的状态转换可能需要按链上顺序执行，但这不等于交易接纳、其他账户的 nonce 分配、查询或 UI 必须同步等待 finalized。实施者先给等待链路加时间戳并定位阻塞点。

当前代码与环境观察到的行为：

- Locus SDK 的提交入口位于 **sdk/src/client.ts**，通过 JamScript Client 提交 Ownership action。
- JamScript Client Ownership V2 的 prepare 路径从 finalized context 读取 Ownership nonce；该控制器没有与旧 wallet V1 相同的本地连续 nonce 预留机制。
- 已升级的 Stage-1 Backend 在 **https://rpc-stage1.minijam.xyz/rpc** 提供 **minijam_getBestContext** 和 **minijam_getFinalizedContext**。2026-10-02 检查时 best 为 slot/block 11296，finalized 为 11294。此 **/rpc** 是面向应用的 JamScript Backend 网关，不是公开的底层节点 RPC。
- 当前发布到 npm 的 **@jamscript/client** 仍为 **0.1.0-rc.4**，其 **queryLatest()** 和 Ownership action preparation 内部固定调用 finalized-context RPC。Locus Web bootstrap 已添加兼容层：JamScript 的这些内部调用读取 best；显式 **bestContext()** 返回 best，**finalizedContext()** 仍读取真正的 finalized head。若 Backend 不提供合法 best context，网络连接会明确失败，不会降级到 finalized。
- 此前端切换改变了 Locus 链上状态读取以及 Ownership nonce/有效 slot 的准备上下文。交易回执 UI 的生命周期语义仍由已有 **waitForAction()** 决定；在 JamScript Client/Backend 提供可验证的 best-included 与 finalized 状态前，不能把“已提交”或“已导入”自行标成 finalized。
- Stage-1 部署配置将应用 RPC 绑定在主机 loopback 的 8090 端口，再由 Caddy 暴露 **/rpc**。Node、Worker、Formal RPC 是内部组件，不应为了支持 best 查询而直接暴露到公网。
- 空投脚本自身目前按顺序提交，并在下一笔前等待 **waitForAction()** 终态。这会额外限制吞吐，须单独调整。

在以下现象被日志或代码确认之前，不要把它们当成已证明事实：Backend 是否存在全局互斥锁、是否已经把多笔交易放入同一 Work、Service 状态转换是否是唯一瓶颈、约一分钟具体耗在出块/Work 还是 finalized。

### 2.1 诊断记录

为同一次请求记录统一的 **requestId**、账户/控制器的非敏感标识、交易 ID、Service ID、上下文区块和单调时钟时间戳。不得记录私钥、签名原文、Matrix token 或可重放的认证信息。

至少测量这些阶段：

1. 读取上下文：请求与返回的 block hash、block number、slot、state root、best/finalized 类型及耗时。
2. 查询账户/Ownership nonce、构造动作、签名、客户端提交请求。
3. Backend 收到请求、通过验证、入队、分配交易 ID、响应客户端。
4. 排队、装入 Work/package、refining、reported、imported、failed 各自耗时。
5. 对应 best head 与 finalized head 的高度/slot、两者差距，以及 head 推进频率。
6. Locus UI 每个按钮何时禁用/恢复，是否等待一个或多个交易的 finalized。
7. 后端、Worker、节点重启与 RPC 超时后的交易最终去向。

交付一份简短基线：至少采样不同控制器的并发提交、同一控制器连续提交、读取延迟、入队到 best 可见耗时、best 到 finalized 耗时。通过此数据确定本次性能指标和真正的 Head-of-Line blocking 点。

## 3. 一致性与状态模型

### 3.1 Best 与 Finalized 是两种明确的读取上下文

JamScript API 应同时提供显式的 best 与 finalized 读取。每次上下文必须是一个不可拆分的快照：

- block hash
- block number 或协议对应的高度字段
- slot
- state root
- context 类型（best 或 finalized）

取得 state root 后，所有账户、Service、Ownership nonce 的查询和证明必须针对同一个 state root。禁止把 best block hash 与 finalized state root 拼成一个表面上合理的上下文。若节点或 Backend 无法提供一致的 best 快照，应返回可识别的错误，不能静默降级成 finalized。

API 命名建议：

- **bestContext()** 与 **finalizedContext()**
- **queryBest(...)** 与 **queryFinalized(...)**
- 对旧 **queryLatest(...)** 明确选择兼容语义并标记弃用；不允许名字仍叫 latest、实际却暗中在 best 与 finalized 间切换。

应用默认选择 best 读取；对账、财务归档、最终成功提示等场景显式选 finalized。

### 3.2 交易生命周期

统一展示和记录以下阶段，具体阶段映射到 Backend 已有枚举；不要重复发明两个互不兼容的状态机：

**accepted/queued → packaged → refining → reported → imported → finalized**

**failed** 和 **reorged/retracted** 是有原因和关联上下文的终态或回退事件。若底层当前没有能可靠报告的 reorged，先提供 **best-chain status unknown**，并补足链头重组观察，不要假装 imported 等同 finalized。

- **accepted/queued**：Backend 已接受并返回追踪 ID，不代表上链。
- **packaged** 到 **imported**：工作流进度；结合协议现有含义展示。
- **imported** 或等价状态：动作在当前 best chain 可见。只有验证过它确实是 best chain 上的导入结果后才能如此标注。
- **finalized**：该结果已最终确定。
- **failed**：展示阶段、稳定错误码和可采取动作。
- **reorged/retracted**：之前 best 上观察到的结果被移除；重新评估依赖与 nonce，不能直接重放签名交易。

### 3.3 下游动作依赖

不同账户彼此独立的交易不应受全局 finalized 闸门约束。若交易 B 必须读取交易 A 修改后的状态：

1. 表达明确依赖 A 的交易 ID 或可验证的 best 状态。
2. 在 A 可于 best chain 读取后，基于包含 A 的 best context 构造 B。
3. 若 A 被重组或失败，标记 B 的依赖失效，并停止自动继续。
4. 如果协议限制 B 必须等 A finalized，说明该协议限制及用户体验；不要把该限制扩展成所有用户、所有 Service 的锁。

## 4. JamScript Backend 实施要求

### 4.1 为应用提供 best context

在 Backend 的公共应用 RPC 增加一致的 best context 能力，并保留 finalized context。检查 Backend 当前连接节点/Formal RPC 的接口，确定从哪个受支持的内部来源获得 best head 和对应 state root。使用协议官方/项目内部支持的查询方式，不要仅靠 HTTP **chain_getBlockHash(null)** 推算状态根。

公开 RPC 仍通过现有 HTTPS 域名与 Caddy **/rpc** 提供。节点、Formal RPC、Worker 的管理端口继续留在受限网络或 loopback。

### 4.2 查询与证明的一致性

- 为 best 与 finalized 提供明确分离的读取入口或显式 context 参数。
- 对状态响应携带上下文标识，便于客户端缓存键和日志按 block hash 区分。
- 对无法服务 best 查询、未知根、过期根和重组，定义稳定错误码。
- 在同一个请求或一组批量查询中固定 context，避免每项查询各自追最新 head。
- 根据负载测量并添加缓存；缓存键必须包括网络、Service、查询 key、context block hash/state root。

### 4.3 异步接纳与队列调度

检查并改造提交链路，使收到合法交易后能尽快返回 **transactionId**，不等待 Work 完成或 finalized。服务端负责持续推进其后台生命周期并提供查询/订阅进度的方式。

排查每一层的锁、promise、数据库事务与队列消费者：

- 清除“等待当前 Service 上一笔交易 finalized 才接纳下一笔”一类同步等待，除非协议确实要求状态依赖。
- Service 状态转换仍按确定性顺序执行；但不同账户、不同 Service 的入队与无依赖预检不能被不必要地串行化。
- 若协议只允许单 Work/单 Service 顺序处理，采用短时间、有上限的微批来装填 Work，不要让每个客户端自己等待前一个客户端 finalized 才能提交。
- 明确队列容量、每账户限额、过载错误与重试 **Retry-After**；不要无限堆积。
- 后端响应中区分“请求已接受”“请求被拒绝”“提交结果未知”。若连接在服务端接纳之后断开，提供按幂等键查询的方式。

不要在未经实现审查和负载测量的情况下引入多个竞争消费者处理同一个有序 Service 状态。可并行的部分并行；需要确定性排序的部分保持唯一、明确的排序规则。

### 4.4 Work/package 批处理与结果关联

先读协议和当前 Backend scheduler 实现，确认一个 Work 能否包含多个用户动作/交易，以及限制来自协议、Backend 还是客户端。用日志统计同一个 Work 中实际承载的交易数，再决定批处理优化是否有效。

若支持批量：

- 采用短聚合窗口与最大 Work 条数/字节数/等待时间上限，二者均配置化。
- 高负载时优先达到最大条数；低负载时不因等待批量而制造新的长延迟。
- 每个交易返回独立 transaction ID、package hash、item/action 索引、结果与失败原因。
- 一笔动作失败时，按协议真实原子性报告整包回滚或单项失败；不能臆测部分成功。
- 处理包超时、重复投递、顺序要求和重组。

若协议不支持多个动作同包，应记录限制、保留异步接纳、减少空闲等待，并提出协议/API 改造提案；不能只把“同一包”作为并行 UX 的唯一方案。

## 5. JamScript Client 实施要求

### 5.1 API 与默认语义

- 增加类型安全的 best/finalized context、查询方法和生命周期状态。
- 将当前 **queryLatest()** 的 finalized 行为迁移为显式命名；若要把默认改成 best，提供主版本/弃用说明，避免静默语义破坏。
- 所有返回的状态附带 context block hash 和 context 类型。
- 支持 Backend 的 HTTP RPC 轮询或订阅接口。若 Stage-1 目前无 WebSocket，不得让浏览器误以为已有订阅能力；可先采用退避轮询，后续再上线订阅。

### 5.2 Ownership nonce 并发分配

Ownership nonce 是同一控制器账户的顺序资源；单纯改为 best 查询并不能解决两个并发请求同时读到同一个 nonce 的竞态。

实现一个每个 Ownership 控制器的原子 nonce lane：

1. 在一致 best context 读取链上当前 nonce，并记录来源 block hash。
2. 在进程内原子预留下一 nonce；同一 JS event loop 的并发 prepare 也必须唯一。
3. 每个预留与交易 ID、签名状态、Backend 接受状态相关联。
4. 成功入队后，在 best 链观察到账户 nonce 推进之前保留 pending reservation；同步 best nonce 时按协议已验证的规则合并链上 nonce 与本地 active reservation。
5. 交易明确失败/被移除后，将该 nonce 标为可恢复或阻塞，依据链上的账户 nonce 和失败阶段处理，不能无条件复用可能已传播的签名。
6. 提交超时进入 **submission-unknown** 并保留 nonce；通过幂等键、transaction ID 或签名交易哈希查询解决。
7. 不同控制器必须独立分配；不同网络、genesis、Service、Ownership controller 的 lane key 要依据实际 **ownershipNonceKey(...)** 与协议定义确定。

本地 lane 只能解决同一个 Client 实例的并发。需要支持多标签页、多设备或同一账户多 Client 时，优先由 Backend 提供原子 nonce/接纳租约或以服务端拒绝重复 nonce 后让客户端安全重建；否则提供浏览器共享锁并明确其覆盖范围。不要声称本地内存缓存解决了跨设备并发。

### 5.3 重组与恢复

保留每笔待处理交易的 nonce、交易哈希/ID、依赖、首次提交时间和最后确认 context。检测到 best head 回退、包含交易的 block 被替换或 nonce 与链上状态冲突时：

- 把状态更新为 **reorged/reconciliation-needed**。
- 查询该交易是否在新 best chain 中、是否仍在 Backend 队列、以及账户 nonce 是否已前进。
- 只有证明原交易未被接纳、也没有可能传播或上链时才能自动重试。
- 在结果未知时向调用方返回待核对状态，不自动重复转账或资产创建。

## 6. Locus SDK 与 Web 前端

### 6.1 SDK

- 给 Locus SDK 提供显式 **queryBest** 与 **queryFinalized** 能力；默认面向交互的资产余额、Ownership 状态和列表从 best 读取。
- SDK 的交易提交调用返回 accepted transaction handle/ID，支持查询生命周期；不要让 **transfer()** 默认阻塞至 finalized。可提供单独的 **waitForBest** 与 **waitForFinalized**。
- 响应和缓存携带 context。切换网络、Service 或链头时正确作废缓存。
- 对“读取依赖前一笔交易”的调用允许显式传入依赖交易和期望上下文。

### 6.2 Web 交互

- Locus Web 的状态读取与 Ownership action preparation 使用 Backend best context；finalized context 保留给明确的最终确认与恢复检查。Best context 无法读取时应显示连接错误，不可悄悄退回 finalized。
- 用户签名后立即显示“已提交/处理中”及交易 ID；随后更新“已打包”“已进入当前链”“已最终确认”或失败/重组状态。
- 同一用户的其他无依赖操作和其他用户的交易不因一笔交易 pending 而禁用。按具体账户/表单限制重复点击，不设全局 loading lock。
- best 可见结果可乐观更新，但在 finalized 前标记为可回退；发生重组时撤销乐观状态并给出清楚提示。
- UI 同时显示必要的 finalized 状态，特别是用户可能以为付款已不可逆的页面。
- 对余额不足、nonce 冲突、队列过载、后端不可达和结果未知给出不同恢复指引。
- 若增加 head 状态指示器，展示 best/finalized 的状态与落后量；不要用空白区块数代替交易状态。

### 6.3 Airdrop 工具

空投脚本当前逐笔等待终态，是脚本自身的串行限制。改为配置化的有界并发 pipeline，而不是一次性同时提交全部收款人：

- 初始并发建议 4，作为可调起点；Stage-1 观测后再提升。
- 先持久化分配清单、金额、收款人、幂等键，再提交。
- 获得 transaction ID 后立即持久化，之后异步轮询/订阅进度。
- 只在明确证明尚未提交时重试；未知结果先 reconciliation。
- 保持既定随机分配，不因恢复或进程重启重新抽样。
- 输出 accepted、best-included、finalized、failed、unknown 五类进度及 DOT 汇总。
- 根据队列/backpressure 自动降并发；尊重单一 treasury 控制器的 nonce lane。

## 7. 幂等性、错误处理与可观测性

每个提交请求接受客户端生成的幂等键。Backend 在保留期内对同一网络和调用方返回同一交易 ID，不产生重复动作。保留期要覆盖最长正常 finalized 延迟与常见重启窗口，并可配置。

错误需有稳定机器码、阶段、是否可能已接纳、是否可安全重试、关联 transaction ID/context。建议至少覆盖：

- **INVALID_ACTION**
- **STALE_CONTEXT**
- **NONCE_CONFLICT**
- **QUEUE_FULL**
- **SUBMISSION_UNKNOWN**
- **BEST_CONTEXT_UNAVAILABLE**
- **STATE_ROOT_UNAVAILABLE**
- **TRANSACTION_REORGED**
- **DEPENDENCY_NOT_VISIBLE**
- **FINALITY_TIMEOUT**

日志和指标至少包括：

- 按阶段的请求数、失败数和 p50/p95/p99 耗时。
- 入队深度、拒绝量、排队时间、每 Work 交易数、Work 构造等待时间。
- best 到 finalized 的延迟与 head 推进率。
- 每个控制器 nonce lane 的 pending 数、冲突、未知结果与恢复量。
- 因重组、超时、Backend/Worker/节点重启而待核对的交易数。

禁止在日志、跟踪 span、错误响应和前端遥测里记录任何密钥或 token。

## 8. 必须验证的场景

Codex 实施时新增或更新自动化验证；本任务文档本身不要求现在运行测试。验收至少覆盖：

1. 两个不同控制器并发提交：第二笔在第一笔 finalized 前获得 transaction ID。
2. 同一个控制器并发准备多笔 Ownership action：nonce 唯一且符合链上顺序。
3. 同一 Client 与两个标签页/两个 Client 的并发行为和冲突恢复。
4. Backend 重复收到同一幂等键：只生成一个动作并返回同一 ID。
5. 返回 ID 后客户端断线、Backend 重启、Worker 重启，交易仍可追踪。
6. best 查询上下文中的 block hash 与 state root 一致；节点不提供 best 时 API 明确失败，不静默返回 finalized。
7. 多笔交易装入同一 Work 时每笔结果关联正确；若协议不支持，验证异步接纳仍可独立推进。
8. best chain 重组、交易失败、提交响应丢失、nonce 前进但回执暂缺。
9. Locus 从 best 更新状态并可撤销重组结果；finalized 标签只在终结后展示。
10. 空投达到并发上限、有界降速、保存恢复且无重复付款。

性能验收要求：

- 不依赖其他用户交易 finalized 的交易，在服务可用和队列未满时迅速取得 ID；建议 Backend 接纳 p95 小于 1 秒，最终阈值按 Stage-1 实测确认。
- Locus 的 Best 状态刷新延迟以 best head 推进为准，不再人为等待约一分钟的 finalized 才可见。
- 报告 best inclusion 与 finalized 的 p50/p95/p99，两者不可合成一个数字。
- 高峰下队列有上限、有过载提示，不以无限排队伪造低延迟。

## 9. 部署顺序与回滚

### 9.1 发布顺序

1. 在 feature flag 后实现 Backend best context、生命周期和幂等 API；保留旧 finalized API。
2. 在 Stage-1 内部对照验证 best block 与 state root，先发布 Backend。
3. 发布 JamScript Client 新版本，显式配置 best 默认值及 finalized 查询入口。
4. 发布 Locus SDK 与 Web，先小范围启用 best 读与快速 accepted 状态。
5. 再启用 bounded parallel airdrop pipeline；不能在状态 reconciliation 未通过时重跑旧 unknown 交易。
6. 逐步提升并发并观察指标；每一步记录发布版本、配置、链高度和回滚点。

### 9.2 回滚

- Web/SDK 可通过 feature flag 退回 finalized 读取和单笔提交行为。
- Backend 保持旧 RPC 方法兼容；新方法关闭不应中断既有客户端。
- 回滚前持久化队列、交易映射、幂等记录和 nonce reservation；禁止清空状态表来“修复”冲突。
- 回滚期间已处于 unknown 的交易先对链与 Backend 对账，不能盲目重放。
- 不公开 Node、Worker、Formal RPC、密钥或管理端口；Stage-1 公网仍只通过 HTTPS Caddy 与应用 RPC。

## 10. 当前空投的安全恢复门槛

截至 2026-10-02 05:56:43 UTC，已有本地协调结果记录为：

- **applied**: 21
- **failed**: 16（其中 14 个暂时跳过的 Matrix 成员，以及 2 笔链上确认失败）
- **pending**: 1
- **unknown**: 333
- **queued**: 217
- 已确认发放：16,346.9501 DOT

333 笔 unknown 没有本地 transaction ID/action hash；另有一笔 pending 的 RPC 结果报告 canonical managed-state root disagreement。数字可能已随链上后续处理变化；它们是恢复核对的起点，不是当前实时余额或成功状态。

在 Codex 实施前或实施期间：

1. 保留现有 allocation 和所有本地状态文件，禁止重新随机分配。
2. 先用链上余额/事件、Backend 队列、账户 nonce 与保存的输入清单核对每一笔 unknown/pending。
3. 每笔归类为已执行、明确未执行可安全补发、仍未知；仍未知继续暂停，不做自动重试。
4. 只对确认未执行且 nonce 安全的受益人生成补发清单，并维持既定最低额与上限规则。
5. 生成新链路后先用少量可核验转账 canary，确认 UI、Backend、链上结果关联一致，再恢复批量。

## 11. 推荐 Codex 执行清单

按下列顺序实施，每个阶段都提交简短变更说明、涉及文件、指标/日志证据和待解决限制：

1. 检查 Locus、JamScript Client、JamScript Backend 的仓库版本和锁文件；当前 Locus 依赖安装版本与 JamScript 仓库源码必须核对，不能只改工作区源码而不发布依赖版本。
2. 完成第 2 节诊断，明确一分钟花在哪个阶段，并确认协议的 best context、Work 聚合和 Ownership nonce 语义。
3. 设计并实现 Backend best context、快照一致性、异步接纳、幂等性与生命周期查询。
4. 实现 JamScript Client 显式 best/finalized API、nonce lane、重组核对和错误语义。
5. 实现 Locus SDK 与前端的 best 读取、pending overlay、细粒度 loading 和 finalized 提示。
6. 更新空投脚本的持久化并发 pipeline 和 reconciliation；先运行只读 dry run 输出恢复分类，不提交资金。
7. 增补第 8 节场景的测试与性能测量；报告结果，不以编译通过代替并发/重组验收。
8. 部署 Stage-1 canary，观察指标，完成小额对账，再逐步启用。

每一阶段完成后检查 diff、依赖发布与部署配置，确保没有把本地秘密写入代码、日志、构建产物或 Git。未经核实的协议假设和未解决的 unknown 交易必须列入交付说明。
