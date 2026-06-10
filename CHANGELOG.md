# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- `db.ts`: PostgreSQL 客户端不再注册 Mokelay 平台专属表 schema，数据库 Block 继续通过动态 SQL 访问数据源。

### Removed
- 移除 `database/schema` 导出；Mokelay 平台表定义迁移至 `mokelay-server/server/database/schema.ts`。

---

## [0.1.15] - 2026-06-10

### Added
- `database/schema.ts`: 新增 `apps` 表，包含自增 `id`、8 位唯一 `uuid`、`alias` 和 `description` 字段；`uuid` 默认由 PostgreSQL 生成。
- `database/schema.ts`: 新增 `AppRecord` 与 `NewAppRecord` 类型导出。

---

## [0.1.14] - 2026-06-09

### Added
- `database/schema.ts`: 新增 `api_domains` 表，包含 `uuid`、`alias` 和唯一 `host` 字段，并导出 `ApiDomainRecord`、`NewApiDomainRecord` 类型。
- `blocks/githubCommit`: 新增 GitHub 远程提交 Block，通过 GitHub Git Database API 创建 blob、tree 和 commit，并更新已有分支引用。
- `blocks/gitlabCommit`: 新增 GitLab 远程提交 Block，通过 GitLab Commits API 在已有分支中批量创建、更新或删除文件。
- `blocks/gitShared`: 新增 GitHub/GitLab 共用的输入校验、文件操作规范化、提交计数、HTTP 响应解析和错误映射能力。
- Git commit Blocks 支持 UTF-8/Base64 文件内容、可选提交作者、`expectedHeadSha` 乐观锁，以及 GitHub Enterprise/GitLab 自建实例地址。
- 新增 `BLOCK_GIT_INPUT_INVALID`、`BLOCK_GIT_AUTH_FAILED`、`BLOCK_GIT_BRANCH_NOT_FOUND`、`BLOCK_GIT_HEAD_MISMATCH`、`BLOCK_GIT_REQUEST_FAILED` 错误码。

### Changed
- `blocks/index`: 注册 `githubCommit`、`gitlabCommit` 执行器及统一输出字段。
- `orchestration.ts`: Debug 数据中的 `token` 字段统一脱敏为 `[redacted]`，避免访问令牌泄露。

---

## [0.1.13] - 2026-06-08

### Added
- `blocks/listApifoxApis`: 新增 `folderId`、`apiId` 可选输入，支持通过 APIFox OpenAPI 导出能力读取指定目录下的接口列表，或按接口 ID 读取单个接口详情；当两者同时传入时优先使用 `apiId`。
- `blocks/listApifoxApis`: API 列表项新增 `parameterDetails`、`requestBodyParameters`、`responseDetails`、`responseBodyParameters`，用于返回路径/查询/Header/Cookie 参数、请求体字段、响应状态、响应示例、响应体字段的说明与示例值。

### Changed
- `blocks/listApifoxApis`: 保留原有 `parameters`、`requestBodyContentTypes`、`responseStatusCodes` 输出，扩展详情字段以兼容旧调用方。

---

## [0.1.12] - 2026-06-08

### Changed
- `blocks/create`: MySQL 创建记录时优先返回输入字段中的主键值，再回退到 `insertId`，避免手动指定 UUID 时被自增 ID 覆盖。

---

## [0.1.11] - 2026-06-08

### Added
- `blocks/listApifoxProjects`: 新增 APIFox 项目列表 Block，支持读取当前访问令牌可见的项目列表。
- `blocks/apifoxShared`: 抽取 APIFox base URL、locale、访问令牌和 URL 构建等共享逻辑。

### Changed
- `blocks/listApifoxApis`: 改为复用 APIFox 共享逻辑，并对导出请求启用手动重定向处理。

---

## [0.1.10] - 2026-06-07

### Added
- `blocks/listApifoxApis`: 新增 APIFox 接口列表 Block，通过导出 OpenAPI 解析接口路径、方法、标签、参数名、请求体 Content-Type 与响应状态码。
- `blocks/index`: 注册 `listApifoxApis` 执行器及 `apis`、`count`、`openapi` 输出。

---

## [0.1.9] - 2026-06-07

### Changed
- 版本发布：未包含功能性变更。

---

## [0.1.8] - 2026-06-07

### Added
- `blocks/analyzeDataSource`: 新增 AI 数据源分析 Block，支持文本输入、补充提示词和 multipart 图片上传，输出结构化分析结果。
- `orchestration.ts`: 支持按声明字段读取 `multipart/form-data` 请求体，供图片上传类 Block 使用。

### Changed
- `ai-data-source.ts`: 拆分并导出通用 `analyzeDataSource` 能力，支持本地 JSON 解析、图片分析、补充提示词和 AI 配置错误识别。
- `orchestration.ts`: 调试追踪中对 Buffer/Uint8Array 输出体积摘要，避免直接记录二进制内容。

---

## [0.1.7] - 2026-06-07

### Changed
- 版本发布：未包含功能性变更。

---

## [0.1.6] - 2026-06-07

### Added
- `blocks/schema`: 新增 schema Block，用于读取当前 PostgreSQL/MySQL 数据源的基础表与列结构。
- `scripts/publish.mjs`: 新增 npm 发布脚本，支持自动递增 patch 版本并发布。
- `package.json`: 新增 `publish:npm` 命令。

### Changed
- `database-schema.ts`: 导出 `DatabaseSchemaQueryRow`，供 schema Block 复用。
- `db.ts`: 优化无效数据库连接 URL 的错误信息。

---

## [0.1.5] - 2026-06-07

### Changed
- `db.ts`: 数据库连接 URL 解析失败时输出错误日志，并返回更明确的 datasource URL 错误。

---

## [0.1.4] - 2026-06-07

### Added
- `db.ts`: Datasource 连接支持分拆环境变量配置，当 `{datasource}_DATABASE_URL` 未配置时，自动读取 `{datasource}_Type`、`{datasource}_Host`、`{datasource}_Port`、`{datasource}_Schema`、`{datasource}_User`、`{datasource}_Password` 六个 Key 拼接连接 URL。

### Changed
- `package.json`: 新增 `build:watch` 脚本，支持 TypeScript 增量编译监听，方便本地联调。

---

## [0.1.3] - 2026-06-03

### Added
- `database/schema.ts`: API 节点 schema 新增 `layout` 字段（jsonb），用于存储节点布局信息。
- `processors/default_value`: 新增 `default_value` processor，当当前值为 `null`、`undefined` 或空字符串时返回配置的 fallback 值，适合兼容新增的可选请求字段。

---

## [0.1.2] - 2026-06-01

### Added
- `controllers/if_controller`: 新增 if 分支控制器，支持基于条件表达式的流程分支。
- `controllers/switch_controller`: 新增 switch 多分支控制器。
- `orchestration-schema.ts`: 大幅扩展 orchestration schema，支持 Graph 模式的节点与边定义。
- `orchestration.ts`: 新增 graph controller 编排执行逻辑。

---

## [0.1.1] - 2026-05-30

### Added
- `orchestration.ts`: 新增编排调试追踪（debug traces），每个 Block 执行时记录 inputs/outputs，便于问题排查。
- `orchestration-schema.ts`: 新增 debug 相关 schema 字段。

---

## [0.1.0] - 2026-05-27

### Added
- 初始版本发布，包含完整的核心功能：
  - **Blocks**：`list`、`page`、`count`、`read`、`create`、`update`、`upsert`、`delete`、`assertUnique`、`addSession`、`readSession`、`removeSession`、`saveJsonToR2`。
  - **Processors**：`email_check`、`env_value`、`eq`、`equals`、`hash_check`、`hash_make`、`is_null`、`is_not_null`、`max`、`min`、`not_null`、`number_check`、`regex`、`trim`、`api_json_when_published`。
  - **Database**：支持 PostgreSQL 与 MySQL，基于 Drizzle ORM，连接池管理与多 datasource 支持。
  - **Orchestration**：Block 编排引擎，支持条件、参数解析、SQL 执行。
  - **Session**：基于 KV 的会话管理。
  - **R2**：JSON 文件上传至 Cloudflare R2。
  - **CORS**、**Password**、**AI Data Source** 等工具模块。
