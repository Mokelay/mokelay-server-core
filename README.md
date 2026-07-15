# mokelay-server-core

Core server utilities for Mokelay.

## Custom Blocks

宿主服务可以通过 `createMokelayOrchestrationHandler` 注册自己的 Block：

```ts
createMokelayOrchestrationHandler({
  blockDefinitions: {
    example: {
      executor: async ({ inputs }) => ({ value: inputs.value }),
      allowedOutputs: ['value'],
    },
  },
})
```

需要数据库连接的 Block 设置 `requiresDatasource: true`，并在 DSL 的 `inputs.datasource` 中声明数据源。自定义名称不能覆盖内置 Block。

## Terminal Responses

API JSON 支持旧版顶层 `response`，也支持按结束点配置的 `responses`：

```json
{
  "responses": {
    "success_block": { "ok": true },
    "false_node": { "ok": false }
  }
}
```

当流程结束在 `nextBlock: null` 时，普通 block 使用 block UUID，controller 分支使用 node UUID，`starter` 直接结束时使用 `starter`。运行时优先使用 `responses[terminalUuid]`，未配置时回退到顶层 `response`。

普通 Block（包括 `executeFragment`）可选配置 `errorNextBlock`。Block 执行失败时，未配置该字段会保持原有抛错行为；配置为另一个 Block UUID 时进入错误分支，配置为 `null` 时以当前 Block UUID 作为终点并选择对应的 `responses`。这适用于 OAuth callback 等必须把后续编排错误转换成重定向响应的流程。

## Fragments

复用编排使用 `fragment: true` 与 `params` 声明，不配置 HTTP `method/request`，也不能通过 HTTP 路由直接执行：

```json
{
  "uuid": "format_name",
  "fragment": true,
  "params": ["name"],
  "blocks": [{ "uuid": "starter", "nextBlock": null }],
  "response": { "name": { "template": "{{params.name}}" } }
}
```

普通 API 通过 `executeFragment` Block 调用；`fragmentUuid` 必须是字面量，`outputs` 固定为 `["result"]`。Fragment 只能访问自己的 `params`、`blocks` 与调用链共享的 `now`，V1 不支持 Fragment 嵌套。

Fragment 与调用方使用同一所有权域，内置和用户编排不能互相引用：

- 内置 API 位于 `server/assets/mokelay-apis/{uuid}.json`，只能引用 `server/assets/mokelay-apis/fragment/{uuid}.json`（Nitro 使用相同的 asset key 结构）。内置 Fragment 不查询数据库或 R2。
- 用户 API 来自 R2/数据库，只能引用 `apis` 表中 `status=published AND fragment=true` 的记录。用户 Fragment 不查询内置 assets 或 R2。
- 两个域即使存在相同 Fragment UUID，也会各自解析本域定义。HTTP 顶层加载只检查 `mokelay-apis/` 根目录，因此 `fragment/` 下的内置配置不能被独立访问。

普通 HTTP API 从 R2 读取前会检查数据库中的当前元数据；如果 UUID 已成为 Fragment、数据库记录已删除或类型检查失败，会拒绝执行旧 R2 对象。未配置 Mokelay 数据库的 R2-only 部署仍可直接读取 R2，但用户 Fragment 仍要求数据库中的已发布记录。宿主注入 `loadApiJson` 时，该 loader 继续同时负责顶层 API 与其 Fragment，方便测试及自定义嵌入；自定义 Block 不能绕过 `executeFragment` 直接调用 Fragment。

直接调用 `executeApiJson(event, rawApiJson, options)` 时，raw DSL 默认视为用户 API；执行内置 raw DSL 需要设置 `options.apiJsonSource: "system"`。`createMokelayOrchestrationHandler` 会根据顶层 API 的实际加载位置自动判定来源，不需要设置该选项。

## Publish

```sh
npm run publish:npm
```

This checks npm auth, prompts `npm login` when needed, runs typecheck/build/test, bumps the patch version, and publishes to npm.
