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

## Publish

```sh
npm run publish:npm
```

This checks npm auth, prompts `npm login` when needed, runs typecheck/build/test, bumps the patch version, and publishes to npm.
