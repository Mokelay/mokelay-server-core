# mokelay-server-core

Core server utilities for Mokelay.

## Publish

```sh
npm run publish:npm
```

This checks npm auth, prompts `npm login` when needed, runs typecheck/build/test, bumps the patch version, and publishes to npm.
