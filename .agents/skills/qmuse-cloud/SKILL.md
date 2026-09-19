---
name: qmuse-cloud
description: 用户明确选择 QMuse 云服务，或 QMuse Web 应用需要云数据库持久化、云存储（文件存储或对象存储）、图片上传、附件上传、文件上传、表单记录、多人共享数据、数据权限、登录会话、服务端密钥、定时任务、云函数或可信服务端逻辑时使用；也用于检查和修复 QMuse 云服务生成产物。不要用于普通静态页面或其它数据库后端。
---

# QMuse 云服务

## 沟通边界

- 技能加载后，正常流程最多发送两条用户可见中间进度：开始初始化云服务，以及初始化成功后开始生成数据模型和业务代码；跳过初始化时只发送实施进度。每个阶段最多一次，每次一句话。
- 只有出现具体检查错误或真实阻塞时，才额外发送一条修复进度，说明问题和下一项动作；不要在常规工具调用前后重复汇报。
- 所有面向用户的自然语言统一使用“QMuse 云服务”，不得主动出现底层云服务实现名称；只有用户明确询问底层实现、版本或故障时才按需说明。
- 用户侧称呼不改变技术实现：源码、依赖、配置和接口继续使用契约规定的原始名称，不得为隐藏底层实现而重命名。
- 不得向用户引用、转述或解释本技能、技术契约、内部检查清单和需求映射规则；避免“按技能要求”“先推导用户诉求”“根据内部原则”等元叙述。
- 不单独播报设计方向、内部文件或模板读取、项目结构检查、逐文件创建和例行校验命令；设计方向不得重复说明。
- 只发送一次最终交付，按实际涉及说明生成的数据模型、云服务能力、表权限、云函数设计和验证结果，不得为未使用的能力生成无意义章节。默认表权限满足当前需求时，在“已交付内容”中简要说明即可，不得生成“需要你在产品界面完成的操作”；仅当存在尚未生效且必须由用户完成的配置时才增加该章节。

## 生码前的文件能力判断

每轮处理文件相关需求时，先判断操作对象，再决定实现范围；此判断必须早于为该需求查找 SDK、设计接口或修改业务代码。

- 上传新文件、查询、预览、下载：使用现有文件 helper。
- 修改附件标题、图片展示名称，或从相册移除照片：维护业务数据表中的展示名称、记录或附件引用；文案准确表达“修改展示名称”“从相册移除”，不声称修改、删除了云存储原文件。
- 重命名、覆盖或物理删除已上传的云存储原文件：不在作品运行时实现。涉及修改文件名或删除原文件时，仅在创作对话中告知应用创建者或管理员前往「云服务面板 → 文件存储」操作，不把该引导、管理链接或原文件操作按钮生成到作品中。

文件 helper 清单是当前完整能力边界，不是待补齐的示例。缺少修改、删除 helper 表示平台不支持作品运行时执行这些操作；不得搜索新版 SDK、检查底层 Storage 实现、扩展 `appwrite.ts` helper、调用平台管理接口或生成云函数实现。既有代码因此报权限错误时，移除违规调用，不得通过重新登录、升级 SDK、变更 Bucket 权限或换一种调用方式反复尝试。

混合需求只实现可独立成立的部分，先向创作者说明交付范围，再生码；不支持的部分不得生成后再等校验失败。例如“增加照片删除，同时删除云存储内容”，应说明“可实现从相册移除照片；云存储原文件由管理员在云服务面板中删除”，再实现业务记录移除。若创作者明确要求两者必须一起成功，则说明当前无法满足，不擅自改成仅移除记录。没有相关诉求时不主动提示这些限制。

## 启动

首次接入时，技能加载后的第一条项目工具调用必须在项目根目录单独执行：

```bash
qmuse-cli cloud init -d "<应用功能描述>"
```

命令成功前，不得读取、列举或搜索项目文件，也不得读取本技能的 `assets/`、`references/` 或模板。`-d` 使用用户需求中简短、准确且不含密钥的描述。命令不可用或失败时报告阻塞并停止生成；仅检查或修复已初始化的 QMuse 云服务应用时跳过重复初始化。

初始化成功后依次执行：

1. 完整阅读 [references/appwrite-contract.md](references/appwrite-contract.md)。
2. 检查现有 `package.json`、`src/config`、`src/services` 和相关业务代码。
3. `appwrite` 必须使用 Runtime SDK peer dependency 要求的 `24.1.1`。用户显式指定兼容的 `@qmuse/appwrite-runtime-sdk` 版本时使用该版本；否则仅在缺少依赖时执行 `ut add @qmuse/appwrite-runtime-sdk@^1.2.0`。使用文件存储时 Runtime SDK 必须为 `1.2.0` 或更高版本，已有低版本依赖时先升级。缺少 `appwrite` 时执行 `ut add appwrite@24.1.1`；已有其它版本时先检查所选 Runtime SDK 的 peer dependency，再调整为兼容版本。
4. 新建 `src/services/appwrite.ts` 时使用 [assets/appwrite.ts](assets/appwrite.ts) 作为基线。已有文件只做必要修改并保留业务扩展。
5. 业务确实需要云函数时，再完整阅读 [references/cloud-functions.md](references/cloud-functions.md)。

Runtime SDK 的消费方式以技术契约和 Web 资产为准。仅当项目校验明确报出 SDK API 类型错误时，才读取公开类型声明排障。

## 实施

以当前用户描述为业务事实来源；现有项目、日志和示例只用于确认平台能力、代码约定和失败模式。根据实际需求确定持久化实体、字段与索引、访问主体与共享范围，以及是否需要可信服务端逻辑、触发器或第三方密钥。生成应用只使用平台默认表权限；访问主体与共享范围用于识别用户是否还需要在产品界面调整权限。

第三方服务和密钥需求必须有当前轮生成代码之外的可验证依据：用户明确指定并要求接入该服务、当前轮开始前项目中已经存在该集成，或已加载能力的契约明确要求该集成。不得仅根据功能类型自行选择第三方服务、编造服务地址、模型或密钥名称；当前轮新生成的代码不能反过来作为密钥需求依据。没有明确依据时不得执行 `cloud set-secret`，也不得通过密钥配置要求用户填写推测值；停止依赖该密钥的部分，并在最终交付中说明未实现原因。

只在 `src/services/appwrite.ts` 导入 `appwrite` 和 `@qmuse/appwrite-runtime-sdk`。创建模块级 `Client`、`Account`、`TablesDB`、模块私有的文件 `Storage` 与 Runtime 单例，并把 `window.__MUSE__.appwrite` 中现有 SDK 支持的公开连接配置作为 `appwriteConfig` 传给 Runtime；配置缺失时保留 Runtime SDK 的接口回退，不得硬编码 endpoint、Project ID、Database ID 或 `bucketId`。页面、组件和 hook 只调用领域 Service；领域 Service 只调用 `appwrite.ts` 导出的统一 CRUD、文件或云函数 helper。列表查询使用 `listQmuseRows()`：`queries` 中只放 `Query` 构造器生成的过滤条件，分页使用顶层 `limit`、`cursor` 参数。文件业务使用 `uploadQmuseFile()`、`listQmuseFiles()`、`getQmuseFile()` 和对应 URL helper，Bucket 由 Runtime 配置自动选择。不要在生成应用中复制 Runtime SDK 的配置、Session、重试、文件路由或审计实现。

云存储、文件存储、对象存储、图片上传、附件上传、文件上传和保存图片/文件，统一识别为按业务需要消费的文件存储能力。文件存储要求 `@qmuse/appwrite-runtime-sdk` `1.2.0` 或更高版本；未使用文件存储的存量应用不因本规则强制升级。`storageBucketId` 只能由平台 Runtime 配置提供。不需要图片或文件持久化时，不得为展示占位生成上传逻辑；需要时只保存返回的文件 ID 或 URL 等业务引用，不把文件内容塞进 TablesDB。遇到 `QMUSE_STORAGE_NOT_INITIALIZED` 时明确提示当前应用尚未开启文件存储并停止上传，不得改用硬编码 Bucket、公开临时图床或绕过 Runtime SDK 的直连请求。`qmuse-cli cloud init` 初始化成功且未出现 `QMUSE_STORAGE_NOT_INITIALIZED` 时，不得提示用户再次开启 QMuse 云服务或文件存储；只有初始化失败或运行时真实返回该错误时，才能把开启文件存储列为用户待办。

当前不提供 FormAuth 的 Agent 命令。实际表权限只能在 QMuse 云服务的“数据表权限设置”中修改；生成应用及工作区文件不能读取当前生效的 FormAuth。最终交付按实际状态分层：默认表权限满足当前需求时，只在“已交付内容”中简要说明采用默认权限，不得生成“需要你在产品界面完成的操作”；只有当前需求明确依赖非默认权限时，才增加“需要你在产品界面完成的操作”，并明确列出需要调整的数据表、READ/SUBMIT/EDIT/DELETE 操作和目标成员范围，同时标记依赖该权限的功能尚未完成。仅存在具体但不影响当前功能成立的权限或敏感数据风险时，可以输出“安全建议（不影响当前版本使用）”，说明实际风险和准确的建议配置，不得写成待办。不得输出“如需调整可前往设置”之类没有具体数据表、操作和成员范围的兜底文案。继续完成当前需求中不依赖该权限变更的业务代码；不得生成或修改 FormAuth 配置，不得把权限写入 Schema 或 `.appwrite_auth.json`，不得用页面条件判断、按钮隐藏或云函数校验冒充表权限，也不得声称未通过产品界面配置的权限已经完成。

按照技术契约生成所需产物并实现 Runtime provider、Schema、类型化 CRUD、分页和错误状态。表权限遵循平台默认值。不要改动与当前接入无关的代码、依赖、锁文件或目录。

修改已有 Schema 时，把最近一次 READY Schema 视为不可变基线：保留已有 table、column 和 index；已有 column 的 type、required、size、format、elements、default 等约束一律不改；已有 index 不增删且不改定义。已有 table 只新增 `required: false` 且不带 `default` 的 column。不要查询表中是否有数据来放宽规则，default 也不代表历史数据回填。READY 基线由平台自动读取和校验，不得向用户询问 READY 基线；无法取得时停止猜测，等待前置校验返回结构化差异。

## Schema 失败恢复

遇到 `APPWRITE_SCHEMA_EVOLUTION_UNSUPPORTED`、`APPWRITE_SCHEMA_HISTORY_VALIDATION_FAILED`、`APPWRITE_SCHEMA_VERSION_FAILED`，或 `JsonTable updateAttribute constraint changes are fail-closed until historical data validation and index side-table rebuild are available.` 时，先按结构化差异恢复最近一次 READY 定义，再重新运行产物校验和项目检查。不得通过修改另一个既有约束、删除索引或添加 default 规避失败；Schema hash 或 version ID 变化不代表版本已激活。

同一 fail-closed 错误在恢复后再次出现，且只有新建数据表才能完成本次迭代时，先确定全部有业务含义的新表名称。在修改任何项目文件之前，当前轮只能执行一次 `qmuse-cli cloud schema request-table-replacement --table-ids <逗号分隔的新表标识>` 阻塞命令；这必须早于 `write_file`、`edit_file`、可能写文件的 Bash 或其它修改工具，不得先修改 Schema、Service、CRUD、查询或页面：

```bash
qmuse-cli cloud schema request-table-replacement --table-ids activity_registrations
```

`--table-ids` 使用逗号分隔并一次列出本次所需的全部新表，使用语义化名称；不得自动添加 `_v2`、时间戳或随机后缀。不得调用普通反问工具 `ask_user_question`，不得询问或猜测 READY 基线，不得并行调用任何其它工具；命令发出后立即停止当前执行并等待用户选择。平台自动校验 READY 基线并生成唯一固定确认卡。固定卡的第一个选项为“新建 <新表名> 表（推荐）”（多表时为“新建 N 张数据表（推荐）”），并明确现有测试数据将丢失且不会迁移；第二个选项为“取消本次修改”，说明为“不创建新表；本次功能迭代无法完成。”。不得自行构造普通问询卡、重复执行命令、另行询问 READY 基线或向用户说明旧表的内部兼容保留逻辑。

命令返回平台生成的确认回执后才能修改项目文件：保留旧表声明仅用于满足 append-only 基线，把业务类型、Service、CRUD、查询和页面全部切换到回执绑定的新表，不得在业务类型、Service、CRUD、查询或页面中继续引用旧表。不得改变回执绑定的新表标识，也不得增删本次待确认的新表；重新运行完整产物校验，重新结束本轮并通过质量门后才能同步。命令返回取消结果时立即停止，不得创建、修改或删除项目文件，并说明本次功能迭代未执行。命令不可用、平台未返回确认回执或用户未明确同意新建表时停止。

若模型违反前置协议并先生成了新表代码，最终质量门会返回 `APPWRITE_TABLE_REPLACEMENT_CONFIRMATION_REQUIRED` 并阻止同步。此时不得自行构造确认卡或用普通文本代替；只能使用质量门给出的完整命令原样执行一次并等待用户选择。这是 fail-closed 兜底，不得作为正常实施顺序。

## 云函数

只有前端 TablesDB 与权限不能安全完成可信服务端职责时才生成云函数。普通 CRUD、分页、详情和单用户数据读写不生成；不需要时省略 `functions` 字段和函数目录。

需要云函数时，以 [references/cloud-functions.md](references/cloud-functions.md) 为唯一实现契约，确定调用主体、数据范围、最小 scopes、触发方式、运行时连接和密钥来源。只有浏览器主动调用的函数才在 `appwrite.ts` 增加统一执行 helper。

## 验证

产物校验返回 `QMUSE_STORAGE_MUTATION_UNSUPPORTED` 时，移除违规云文件修改、删除调用及对应运行时操作；`appwrite.ts` 也不能自行扩展此类 helper。仅在创作对话中说明管理员面板操作方式，不得通过改名、底层请求或云函数绕过校验，也不得把管理员引导生成到作品中。

生成完成后必须同时验证云服务产物和项目代码，二者先后顺序按当前改动选择：

1. 运行确定性产物校验器，以及项目自己的 lint、类型检查和相关测试。
2. 修复问题后重新运行所有受影响的检查。
3. 所有文件修改完成后再次运行产物校验器；该次成功是最终交付门禁。

```bash
node "<qmuse-cloud-skill-dir>/scripts/validate_appwrite_artifacts.mjs" "<project-root>"
```

不要顺手修改与本次接入无关的既有 warning；无法验证的部分必须在交付时明确说明。
