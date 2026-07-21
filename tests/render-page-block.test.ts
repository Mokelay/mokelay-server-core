import { describe, expect, it } from 'vitest'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import { executeRenderPageBlock } from '../src/utils/blocks/renderPage.js'

function execute(inputs: Record<string, unknown>) {
  return executeRenderPageBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'home',
    name: 'SSR page',
    blocks: [],
    ...overrides,
  }
}

describe('executeRenderPageBlock', () => {
  it('renders a complete static HTML document with component and shell styles', async () => {
    const result = await execute({
      page: page({
        name: 'Mokelay <SSR> & page',
        blocks: [{ id: 'heading', type: 'MHeading', data: { text: 'Server rendered', level: '1' } }],
      }),
    })

    expect(result.html).toMatch(/^<!doctype html>/)
    expect(result.html).toContain('<meta charset="UTF-8">')
    expect(result.html).toContain('<title>Mokelay &lt;SSR&gt; &amp; page</title>')
    expect(result.html).toContain('class="render-shell"')
    expect(result.html).toContain('data-page-slug="home"')
    expect(result.html).toContain('Server rendered')
    expect(result.html).toContain('.render-page')
  })

  it('resolves static and context data sources into paragraph templates', async () => {
    const result = await execute({
      context: { visitor: { name: 'Context user' } },
      page: page({
        dataSources: [
          { key: 'profile', type: 'static', value: { status: 'ready' } },
          { key: 'visitor', type: 'context', path: 'visitor' },
        ],
        blocks: [{
          id: 'copy',
          type: 'paragraph',
          data: { text: '{{dataSources.profile.status}} / {{dataSources.visitor.name}}' },
        }],
      }),
    })

    expect(result.html).toContain('ready / Context user')
  })

  it('uses datasource defaultValue and fails without a fallback', async () => {
    const failingDatasource = {
      key: 'remote',
      type: 'datasource',
      ds: { type: 'API', domain: '', path: '', method: 'GET', headerData: [], bodyData: [], queryData: [] },
    }
    const fallbackResult = await execute({
      page: page({
        dataSources: [{ ...failingDatasource, defaultValue: { status: 'fallback' } }],
        blocks: [{ id: 'copy', type: 'paragraph', data: { text: '{{dataSources.remote.status}}' } }],
      }),
    })

    expect(fallbackResult.html).toContain('fallback')
    await expect(execute({ page: page({ dataSources: [failingDatasource] }) })).rejects.toMatchObject({
      data: { code: 'BLOCK_RENDER_FAILED' },
    })
  })

  it('rejects invalid page and context inputs', async () => {
    await expect(execute({ page: [] })).rejects.toMatchObject({
      data: { code: 'BLOCK_RENDER_INPUT_INVALID' },
    })
    await expect(execute({ page: page(), context: [] })).rejects.toMatchObject({
      data: { code: 'BLOCK_RENDER_INPUT_INVALID' },
    })
    await expect(execute({ page: { blocks: [] } })).rejects.toMatchObject({
      data: { code: 'BLOCK_RENDER_INPUT_INVALID' },
    })
  })

  it('normalizes unknown block preload failures', async () => {
    await expect(execute({
      page: page({ blocks: [{ id: 'unknown', type: 'UnknownSSRBlock', data: {} }] }),
    })).rejects.toMatchObject({
      data: { code: 'BLOCK_RENDER_FAILED' },
    })
  })

  it('registers html as the only output without a database requirement', () => {
    expect(blockDefinitions.renderPage).toMatchObject({
      allowedOutputs: ['html'],
    })
    expect(blockDefinitions.renderPage?.requiresDatasource).toBeUndefined()
  })
})
