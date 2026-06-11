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

## Publish

```sh
npm run publish:npm
```

This checks npm auth, prompts `npm login` when needed, runs typecheck/build/test, bumps the patch version, and publishes to npm.
