# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `db.ts`: Datasource 连接支持分拆环境变量配置，当 `{datasource}_DATABASE_URL` 未配置时，自动读取 `{datasource}_Type`、`{datasource}_Host`、`{datasource}_Port`、`{datasource}_Schema`、`{datasource}_User`、`{datasource}_Password` 六个 Key 拼接连接 URL。
- `package.json`: 新增 `publish:npm` 命令，用于自动递增 patch 版本并发布到 npm。

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
