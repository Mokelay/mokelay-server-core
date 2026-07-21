import { readFile } from 'node:fs/promises'
import { createRequire, register } from 'node:module'
import { computed, createSSRApp, h, type Component, type InjectionKey } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'

const require = createRequire(import.meta.url)
const cssLoaderSource = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' && specifier.endsWith('/style/css')) {
      return nextResolve(specifier + '.mjs', context)
    }
    throw error
  }
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default undefined' }
  }
  return nextLoad(url, context)
}
`
const renderShellCss = `
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#f8fafc}
*{box-sizing:border-box}body{margin:0;min-width:320px}.render-shell{width:min(960px,calc(100% - 32px));margin:40px auto}.render-page{display:grid;gap:16px;padding:28px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 16px 45px rgb(15 23 42 / 8%)}
`

let runtimePromise: Promise<RenderRuntime> | undefined
let componentCssPromise: Promise<string> | undefined

type RenderRuntime = {
  BlockRenderer: Component
  PreviewBlockRuntimeKey: InjectionKey<unknown>
  createPreviewBlockRuntime: () => unknown
  preloadMokelayBlocks: (types: Iterable<string>) => Promise<void>
  normalizeMokelayPage: (page: unknown) => MokelayPage
  resolvePageDataSources: (dataSources: unknown[], context: PageRuntimeContext) => Promise<Record<string, unknown>>
  PageRuntimeContextKey: InjectionKey<unknown>
  PageRuntimeDataKey: InjectionKey<unknown>
  PageRuntimeVariableContextKey: InjectionKey<unknown>
  PageLocaleConfigKey: InjectionKey<unknown>
  PageReferenceAncestryKey: InjectionKey<unknown>
}

type PageRuntimeContext = Record<string, unknown>
type MokelayBlock = { id?: string; type: string; data: Record<string, unknown> }
type MokelayPage = {
  uuid: string
  name: string
  blocks: MokelayBlock[]
  dataSources?: unknown[]
  localeConfig: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeInputs(inputs: Record<string, unknown>) {
  if (!isRecord(inputs.page)) {
    throw mokelayError('BLOCK_RENDER_INPUT_INVALID', 'page 必须是 Page DSL JSON 对象。', 400)
  }
  if (inputs.context !== undefined && !isRecord(inputs.context)) {
    throw mokelayError('BLOCK_RENDER_INPUT_INVALID', 'context 必须是对象。', 400)
  }

  return { page: inputs.page, context: (inputs.context ?? {}) as PageRuntimeContext }
}

function collectBlockTypes(blocks: unknown[]) {
  const types = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.type === 'string' && isRecord(value.data)) types.add(value.type)
    Object.values(value).forEach(visit)
  }
  visit(blocks)
  return [...types].filter((type) => !['paragraph', 'table', 'columns'].includes(type))
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function registerCssLoader() {
  register(`data:text/javascript,${encodeURIComponent(cssLoaderSource)}`, import.meta.url)
}

async function loadRuntime(): Promise<RenderRuntime> {
  runtimePromise ??= (async () => {
    registerCssLoader()
    const [rendererModule, registryModule, previewModule, pagesModule] = await Promise.all([
      import('mokelay-components/blocks/MokelayBlockRenderer.vue'),
      import('mokelay-components/blocks/runtimeRegistry'),
      import('mokelay-components/runtime'),
      import('mokelay-components/pages'),
    ]) as [Record<string, any>, Record<string, any>, Record<string, any>, Record<string, any>]
    return {
      BlockRenderer: rendererModule.default,
      PreviewBlockRuntimeKey: previewModule.PreviewBlockRuntimeKey,
      createPreviewBlockRuntime: previewModule.createPreviewBlockRuntime,
      preloadMokelayBlocks: registryModule.preloadMokelayBlocks,
      normalizeMokelayPage: pagesModule.normalizeMokelayPage,
      resolvePageDataSources: pagesModule.resolvePageDataSources,
      PageRuntimeContextKey: pagesModule.PageRuntimeContextKey,
      PageRuntimeDataKey: pagesModule.PageRuntimeDataKey,
      PageRuntimeVariableContextKey: pagesModule.PageRuntimeVariableContextKey,
      PageLocaleConfigKey: pagesModule.PageLocaleConfigKey,
      PageReferenceAncestryKey: pagesModule.PageReferenceAncestryKey,
    }
  })()
  return runtimePromise
}

function loadComponentCss() {
  componentCssPromise ??= readFile(require.resolve('mokelay-components/style.css'), 'utf8')
  return componentCssPromise
}

async function renderPage(page: MokelayPage, context: PageRuntimeContext) {
  const runtime = await loadRuntime()
  await runtime.preloadMokelayBlocks(collectBlockTypes(page.blocks))
  const runtimeData = await runtime.resolvePageDataSources(page.dataSources ?? [], context)
  const runtimeContextRef = computed(() => context)
  const runtimeDataRef = computed(() => runtimeData)
  const variableContextRef = computed(() => ({
    pageId: page.uuid,
    context,
    dataSources: runtimeData,
    pageData: runtimeData,
    [page.uuid]: runtimeData,
    ...runtimeData,
  }))
  const app = createSSRApp({
    render: () => h('main', { class: 'render-shell' }, [
      h('article', { class: 'render-page', 'data-page-slug': page.uuid },
        page.blocks.map((block, index) => h(runtime.BlockRenderer, {
          key: block.id ?? `${block.type}-${index}`,
          block,
        }))),
    ]),
  })

  app.provide(runtime.PreviewBlockRuntimeKey, runtime.createPreviewBlockRuntime())
  app.provide(runtime.PageRuntimeContextKey, runtimeContextRef)
  app.provide(runtime.PageRuntimeDataKey, runtimeDataRef)
  app.provide(runtime.PageRuntimeVariableContextKey, variableContextRef)
  app.provide(runtime.PageLocaleConfigKey, computed(() => page.localeConfig))
  app.provide(runtime.PageReferenceAncestryKey, computed(() => [page.uuid]))

  const [bodyHtml, componentCss] = await Promise.all([renderToString(app), loadComponentCss()])
  const title = escapeHtml(page.name || page.uuid)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>${componentCss}\n${renderShellCss}</style></head><body>${bodyHtml}</body></html>`
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "renderPage",
 *   "displayName": "渲染页面 HTML",
 *   "category": "page",
 *   "description": "将 Page DSL JSON 服务端渲染为包含内联样式的完整静态 HTML 文档。",
 *   "inputs": [
 *     { "key": "page", "type": "Record<string, unknown>", "required": true, "description": "待渲染的 Page DSL JSON 对象。" },
 *     { "key": "context", "type": "Record<string, unknown>", "required": false, "defaultValue": {}, "description": "页面 context 数据源和变量使用的运行时上下文。" }
 *   ],
 *   "outputs": [
 *     { "key": "html", "type": "string", "description": "包含 doctype、head、内联 CSS 和 SSR body 的完整静态 HTML。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_RENDER_INPUT_INVALID", "description": "page 或 context 输入无效。" },
 *     { "code": "BLOCK_RENDER_FAILED", "description": "Block 预加载、页面数据源解析或 SSR 渲染失败。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "Page DSL dataSources", "description": "页面包含 datasource 数据源时会发起外部请求。" },
 *     { "key": "hydration", "type": "boolean", "value": false, "description": "输出不包含客户端 JavaScript，不支持浏览器端交互和 hydration。" }
 *   ],
 *   "examples": [
 *     { "title": "渲染页面", "block": { "uuid": "render_page", "functionName": "renderPage", "inputs": { "page": { "template": "{{request.body.page}}" }, "context": { "template": "{{request.body.context}}" } }, "outputs": ["html"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeRenderPageBlock: BlockExecutor = async ({ inputs }) => {
  const { page: rawPage, context } = normalizeInputs(inputs)
  try {
    const runtime = await loadRuntime()
    let page: MokelayPage
    try {
      page = runtime.normalizeMokelayPage(rawPage)
    } catch (error) {
      throw mokelayError('BLOCK_RENDER_INPUT_INVALID', 'page 不是有效的 Page DSL JSON。', 400, error)
    }
    return { html: await renderPage(page, context) }
  } catch (error) {
    if (isRecord(error) && isRecord(error.data) && error.data.code === 'BLOCK_RENDER_INPUT_INVALID') throw error
    throw mokelayError('BLOCK_RENDER_FAILED', '页面 HTML 渲染失败。', 500, error)
  }
}
