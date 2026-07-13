import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDatasourceConnection } from '../src/utils/db.js'

const datasource = 'CloseDatasourceTest'
const envName = `${datasource}_DATABASE_URL`
const databaseUrl = 'mysql://root@127.0.0.1:3306/close_datasource_test'

type DatasourceGlobal = typeof globalThis & {
  __mokelayDatasourceDbs?: Map<string, {
    client: { end: () => Promise<void> }
  }>
}

const state = globalThis as DatasourceGlobal
const originalConnections = state.__mokelayDatasourceDbs
const originalDatabaseUrl = process.env[envName]

afterEach(() => {
  state.__mokelayDatasourceDbs = originalConnections
  if (originalDatabaseUrl === undefined) delete process.env[envName]
  else process.env[envName] = originalDatabaseUrl
})

describe('closeDatasourceConnection', () => {
  it('closes and evicts an opened datasource connection', async () => {
    const end = vi.fn(async () => {})
    const connections = new Map<string, { client: { end: () => Promise<void> } }>()
    connections.set(`${envName}:${databaseUrl}`, { client: { end } })
    state.__mokelayDatasourceDbs = connections
    process.env[envName] = databaseUrl

    await expect(closeDatasourceConnection(datasource)).resolves.toBe(true)
    expect(end).toHaveBeenCalledOnce()
    expect(connections).toHaveLength(0)
  })

  it('does not create a connection when none was opened', async () => {
    state.__mokelayDatasourceDbs = new Map()
    process.env[envName] = databaseUrl

    await expect(closeDatasourceConnection(datasource)).resolves.toBe(false)
    expect(state.__mokelayDatasourceDbs).toHaveLength(0)
  })
})
