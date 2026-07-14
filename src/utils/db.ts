import { createError } from 'h3'
import { type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { drizzle as drizzleMysql, type MySql2Database } from 'drizzle-orm/mysql2'
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { createPool, type Pool, type ResultSetHeader } from 'mysql2/promise'
import postgres from 'postgres'
import { mokelayError } from './mokelay-error.js'

export type DatabaseType = 'postgres' | 'mysql'

type PostgresDatabase = PostgresJsDatabase<Record<string, never>> & { $client: postgres.Sql }
type MysqlDatabase = MySql2Database<Record<string, never>> & { $client: Pool }

type PostgresDatabaseConnection = {
  databaseType: 'postgres'
  client: postgres.Sql
  db: PostgresDatabase
}

type MysqlDatabaseConnection = {
  databaseType: 'mysql'
  client: Pool
  dialect: MySqlDialect
  db: MysqlDatabase
}

type DatabaseConnection = PostgresDatabaseConnection | MysqlDatabaseConnection

export type SqlExecutionResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  databaseType: DatabaseType
  rows: T[]
  affectedRows?: number
  insertId?: number | string | bigint
}

export type TransactionIsolationLevel = 'read committed' | 'repeatable read' | 'serializable'

export type TransactionOptions = {
  isolationLevel?: TransactionIsolationLevel
  /** Number of retries after the first attempt for serialization/deadlock failures. */
  retries?: number
}

export type TransactionSqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(
  query: SQL,
) => Promise<SqlExecutionResult<T>>

export type TransactionRunner = <T>(
  callback: (executeSql: TransactionSqlExecutor) => Promise<T>,
  options?: TransactionOptions,
) => Promise<T>

const defaultTransactionRetries = 2
const maxTransactionRetries = 10

export function normalizeTransactionRetries(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return defaultTransactionRetries
  return Math.min(maxTransactionRetries, Math.max(0, Math.trunc(value)))
}

const globalForDb = globalThis as typeof globalThis & {
  __mokelayPostgresClient?: postgres.Sql
  __mokelayDb?: PostgresDatabase
  __mokelayDatasourceDbs?: Map<string, DatabaseConnection>
}

const mokelayDatabaseUrlEnvName = 'Mokelay_DATABASE_URL'
const datasourceNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

function createPostgresClient(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 5,
    prepare: false,
  })
}

function createMysqlClient(databaseUrl: string) {
  return createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: 5,
  })
}

function createPostgresDatabaseConnection(databaseUrl: string): PostgresDatabaseConnection {
  const client = createPostgresClient(databaseUrl)

  return {
    databaseType: 'postgres',
    client,
    db: drizzlePostgres(client),
  }
}

function createMysqlDatabaseConnection(databaseUrl: string): MysqlDatabaseConnection {
  const client = createMysqlClient(databaseUrl)

  return {
    databaseType: 'mysql',
    client,
    dialect: new MySqlDialect(),
    db: drizzleMysql(client),
  }
}

function datasourceConnections() {
  if (!globalForDb.__mokelayDatasourceDbs) {
    globalForDb.__mokelayDatasourceDbs = new Map()
  }

  return globalForDb.__mokelayDatasourceDbs
}

export function detectDatabaseType(databaseUrl: string): DatabaseType {
  let protocol: string

  try {
    protocol = new URL(databaseUrl).protocol.replace(/:$/, '').toLowerCase()
  } catch (error) {
    console.error('数据库连接 URL 不是合法 URL:', error)
    throw mokelayError('BLOCK_DATASOURCE_UNSUPPORTED_DATABASE', '数据库连接 URL 不是合法 URL。', 500, error)
  }

  if (protocol === 'postgres' || protocol === 'postgresql') {
    return 'postgres'
  }

  if (protocol === 'mysql') {
    return 'mysql'
  }

  throw mokelayError(
    'BLOCK_DATASOURCE_UNSUPPORTED_DATABASE',
    `不支持的数据库类型：${protocol || 'unknown'}。`,
    500,
  )
}

function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const databaseType = detectDatabaseType(databaseUrl)

  return databaseType === 'postgres'
    ? createPostgresDatabaseConnection(databaseUrl)
    : createMysqlDatabaseConnection(databaseUrl)
}

export function normalizeDatasourceName(datasource: unknown) {
  if (typeof datasource !== 'string' || !datasource.trim()) {
    throw mokelayError('BLOCK_INVALID_DATASOURCE', 'datasource 必须是非空字符串。', 400)
  }

  const name = datasource.trim()

  if (!datasourceNamePattern.test(name)) {
    throw mokelayError('BLOCK_INVALID_DATASOURCE', 'datasource 只能包含字母、数字、下划线，且不能以数字开头。', 400)
  }

  return name
}

export function datasourceDatabaseUrlEnvName(datasource: unknown) {
  return `${normalizeDatasourceName(datasource)}_DATABASE_URL`
}

function buildDatabaseUrlFromParts(datasource: string): { envName: string; databaseUrl: string } {
  const typeEnvName = `${datasource}_Type`
  const hostEnvName = `${datasource}_Host`

  const databaseType = process.env[typeEnvName]

  if (databaseType !== 'postgres' && databaseType !== 'mysql') {
    throw mokelayError(
      'BLOCK_DATASOURCE_UNSUPPORTED_DATABASE',
      `${typeEnvName} 必须是 'postgres' 或 'mysql'。`,
      500,
    )
  }

  const host = process.env[hostEnvName]

  if (!host) {
    throw mokelayError(
      'BLOCK_DATASOURCE_URL_MISSING',
      `${hostEnvName} 未配置。`,
      500,
    )
  }

  const port = process.env[`${datasource}_Port`]
  const schema = process.env[`${datasource}_Schema`] ?? ''
  const user = process.env[`${datasource}_User`] ?? ''
  const password = process.env[`${datasource}_Password`] ?? ''

  const hostWithPort = port ? `${host}:${port}` : host
  const databaseUrl = `${databaseType}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostWithPort}/${schema}`

  return { envName: hostEnvName, databaseUrl }
}

export function datasourceDatabaseUrl(datasource: unknown) {
  const name = normalizeDatasourceName(datasource)
  const envName = `${name}_DATABASE_URL`
  const databaseUrl = process.env[envName]

  if (databaseUrl) {
    return { envName, databaseUrl }
  }

  if (Object.prototype.hasOwnProperty.call(process.env, envName)) {
    throw mokelayError(
      'BLOCK_DATASOURCE_URL_MISSING',
      `${envName} is not configured.`,
      500,
    )
  }

  return buildDatabaseUrlFromParts(name)
}

export function datasourceDatabaseType(datasource: unknown) {
  return detectDatabaseType(datasourceDatabaseUrl(datasource).databaseUrl)
}

export function mokelayDatabaseUrl() {
  const databaseUrl = process.env[mokelayDatabaseUrlEnvName]

  if (!databaseUrl) {
    throw createError({
      statusCode: 500,
      message: `${mokelayDatabaseUrlEnvName} is not configured.`,
    })
  }

  return databaseUrl
}

export function useDb() {
  const databaseUrl = mokelayDatabaseUrl()

  if (!globalForDb.__mokelayPostgresClient) {
    globalForDb.__mokelayPostgresClient = createPostgresClient(databaseUrl)
  }

  if (!globalForDb.__mokelayDb) {
    globalForDb.__mokelayDb = drizzlePostgres(globalForDb.__mokelayPostgresClient)
  }

  return globalForDb.__mokelayDb
}

export function useDatasourceConnection(datasource: string) {
  const { envName, databaseUrl } = datasourceDatabaseUrl(datasource)
  const cacheKey = `${envName}:${databaseUrl}`
  const connections = datasourceConnections()
  let connection = connections.get(cacheKey)

  if (!connection) {
    connection = createDatabaseConnection(databaseUrl)
    connections.set(cacheKey, connection)
  }

  return connection
}

/**
 * Closes and evicts a cached datasource connection, if one was opened.
 * This is primarily useful for finite-lived CLI commands and test runners.
 */
export async function closeDatasourceConnection(datasource: string) {
  const { envName, databaseUrl } = datasourceDatabaseUrl(datasource)
  const cacheKey = `${envName}:${databaseUrl}`
  const connections = datasourceConnections()
  const connection = connections.get(cacheKey)

  if (!connection) return false

  connections.delete(cacheKey)
  await connection.client.end()
  return true
}

export function useDatasourceDb(datasource: string) {
  return useDatasourceConnection(datasource).db
}

function isResultSetHeader(value: unknown): value is ResultSetHeader {
  return typeof value === 'object'
    && value !== null
    && 'affectedRows' in value
    && 'insertId' in value
}

export async function executeDatasourceSql<T extends Record<string, unknown> = Record<string, unknown>>(
  query: SQL,
  datasource: string,
): Promise<SqlExecutionResult<T>> {
  const connection = useDatasourceConnection(datasource)

  if (connection.databaseType === 'postgres') {
    const rows = await connection.db.execute<T>(query)

    return {
      databaseType: connection.databaseType,
      rows: Array.from(rows) as T[],
    }
  }

  const builtQuery = connection.dialect.sqlToQuery(query)
  const [result] = await connection.client.query(builtQuery.sql, builtQuery.params as any[])

  if (Array.isArray(result)) {
    return {
      databaseType: connection.databaseType,
      rows: result as T[],
    }
  }

  return {
    databaseType: connection.databaseType,
    rows: [],
    affectedRows: isResultSetHeader(result) ? result.affectedRows : undefined,
    insertId: isResultSetHeader(result) ? result.insertId : undefined,
  }
}

function normalizeIsolationLevel(value: TransactionIsolationLevel | undefined) {
  return (value ?? 'serializable').toUpperCase()
}

function transactionErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const record = error as Record<string, unknown>
  const code = record.code ?? record.sqlState ?? record.sqlstate
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined
}

function isRetryableTransactionError(error: unknown) {
  let current = error
  const seen = new Set<object>()

  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const code = transactionErrorCode(current)
    if (
      code === '40001'
      || code === '40P01'
      || code === '1213'
      || code === '1205'
      || code === 'ER_LOCK_DEADLOCK'
      || code === 'ER_LOCK_WAIT_TIMEOUT'
    ) return true
    current = 'cause' in current ? current.cause : undefined
  }

  // PostgreSQL serialization_failure/deadlock_detected; MySQL ER_LOCK_DEADLOCK/
  // ER_LOCK_WAIT_TIMEOUT and their SQLSTATE equivalents.
  return false
}

async function executePostgresTransaction<T>(
  connection: PostgresDatabaseConnection,
  callback: (executeSql: TransactionSqlExecutor) => Promise<T>,
  isolationLevel: string,
) {
  return await connection.db.transaction(async (transactionDb) => {
    const executeSql: TransactionSqlExecutor = async <Row extends Record<string, unknown>>(query: SQL) => {
      const rows = await transactionDb.execute<Row>(query)
      return {
        databaseType: 'postgres',
        rows: Array.from(rows) as Row[],
      }
    }

    return await callback(executeSql)
  }, {
    isolationLevel: isolationLevel.toLowerCase() as TransactionIsolationLevel,
  })
}

async function executeMysqlTransaction<T>(
  connection: MysqlDatabaseConnection,
  callback: (executeSql: TransactionSqlExecutor) => Promise<T>,
  isolationLevel: string,
) {
  const client = await connection.client.getConnection()

  try {
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`)
    await client.beginTransaction()

    const executeSql: TransactionSqlExecutor = async <Row extends Record<string, unknown>>(query: SQL) => {
      const builtQuery = connection.dialect.sqlToQuery(query)
      const [result] = await client.query(builtQuery.sql, builtQuery.params as any[])

      if (Array.isArray(result)) {
        return { databaseType: 'mysql', rows: result as Row[] }
      }

      return {
        databaseType: 'mysql',
        rows: [],
        affectedRows: isResultSetHeader(result) ? result.affectedRows : undefined,
        insertId: isResultSetHeader(result) ? result.insertId : undefined,
      }
    }

    const value = await callback(executeSql)
    await client.commit()
    return value
  } catch (error) {
    try {
      await client.rollback()
    } catch {
      // Preserve the transaction's original failure.
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Runs all SQL through a single physical datasource connection. Callers should
 * still lock their own application-level serialization row inside the callback.
 */
export async function executeDatasourceTransaction<T>(
  datasource: string,
  callback: (executeSql: TransactionSqlExecutor) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const connection = useDatasourceConnection(datasource)
  const isolationLevel = normalizeIsolationLevel(options.isolationLevel)
  const retries = normalizeTransactionRetries(options.retries)

  for (let attempt = 0; ; attempt += 1) {
    try {
      return connection.databaseType === 'postgres'
        ? await executePostgresTransaction(connection, callback, isolationLevel)
        : await executeMysqlTransaction(connection, callback, isolationLevel)
    } catch (error) {
      if (attempt >= retries || !isRetryableTransactionError(error)) throw error
    }
  }
}
