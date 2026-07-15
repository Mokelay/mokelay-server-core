import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import {
  linkOAuthIdentity,
  resolveOAuthUser,
  type OAuthProfile,
} from '../src/utils/blocks/oauthShared.js'
import { toMokelayErrorResponse } from '../src/utils/mokelay-error.js'
import { type SqlExecutor } from '../src/utils/orchestration-schema.js'

const pgDialect = new PgDialect()

const profile: OAuthProfile = {
  provider: 'github',
  providerUserId: 'github-42',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada',
  raw: { id: 42, login: 'ada' },
}

const employeeRow = {
  id: 'employee-1',
  enterprise_uuid: 'enterprise-1',
  enterprise_name: 'Ada 的工作区',
  name: 'Ada',
  email: 'ada@example.com',
  plan: 'free',
  provider_user_id: 'github-42',
}

function queryText(query: SQL) {
  return pgDialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()
}

function sqlExecutor(handler: (sql: string) => Record<string, unknown>[]) {
  return (async <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => ({
    databaseType: 'postgres' as const,
    rows: handler(queryText(query)) as T[],
  })) as SqlExecutor
}

describe('deferred OAuth provisioning', () => {
  it('returns Fragment registration inputs without creating an account or identity', async () => {
    const statements: string[] = []
    const executeSql = sqlExecutor((statement) => {
      statements.push(statement)

      if (statement.startsWith('SELECT')) {
        return []
      }

      throw new Error(`Unexpected write: ${statement}`)
    })

    const result = await resolveOAuthUser(executeSql, profile, true, 'postgres', true)

    expect(result).toMatchObject({
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      requiresRegistration: true,
      registration: {
        enterpriseName: 'Ada 的工作区',
        name: 'Ada',
        email: 'ada@example.com',
        provider: 'github',
        providerUserId: 'github-42',
        providerEmail: 'ada@example.com',
        emailVerified: true,
        profile: { id: 42, login: 'ada' },
      },
    })
    expect(result.registration?.passwordHash).toEqual(expect.any(String))
    expect(result.registration?.passwordHash).not.toBe('')
    expect(statements).toHaveLength(2)
    expect(statements.every((statement) => statement.startsWith('SELECT'))).toBe(true)
  })

  it('keeps the existing identity path ready for the callback to create a Session', async () => {
    const executeSql = sqlExecutor((statement) => {
      if (statement.includes('FROM employee_auth_identities')) {
        return [employeeRow]
      }

      throw new Error(`Unexpected statement: ${statement}`)
    })

    await expect(resolveOAuthUser(executeSql, profile, true, 'postgres', true)).resolves.toEqual({
      user: {
        id: 'employee-1',
        enterprise_uuid: 'enterprise-1',
        enterprise_name: 'Ada 的工作区',
        name: 'Ada',
        email: 'ada@example.com',
        plan: 'free',
      },
      isNewUser: false,
      linkedIdentity: false,
      requiresRegistration: false,
      registration: null,
    })
  })

  it('registers the new callback and identity Block outputs', () => {
    expect(blockDefinitions.oauthCallback?.allowedOutputs).toEqual(expect.arrayContaining([
      'requiresRegistration',
      'registration',
    ]))
    expect(blockDefinitions.linkOAuthIdentity).toMatchObject({
      allowedOutputs: ['user', 'linkedIdentity'],
      requiresDatasource: true,
    })
  })
})

describe('linkOAuthIdentity', () => {
  it('binds once, verifies ownership, and is idempotent', async () => {
    const statements: string[] = []
    let identityExists = false
    const executeSql = sqlExecutor((statement) => {
      statements.push(statement)

      if (statement.includes('FROM employee_auth_identities')) {
        return identityExists ? [employeeRow] : []
      }

      if (statement.includes('FROM employees') && statement.includes('WHERE employees.id')) {
        return [employeeRow]
      }

      if (statement.startsWith('INSERT INTO employee_auth_identities')) {
        identityExists = true
        return []
      }

      throw new Error(`Unexpected statement: ${statement}`)
    })

    await expect(linkOAuthIdentity(executeSql, 'employee-1', profile, 'postgres')).resolves.toMatchObject({
      user: { id: 'employee-1', email: 'ada@example.com' },
      linkedIdentity: true,
    })
    await expect(linkOAuthIdentity(executeSql, 'employee-1', profile, 'postgres')).resolves.toMatchObject({
      user: { id: 'employee-1', email: 'ada@example.com' },
      linkedIdentity: false,
    })

    expect(statements.filter((statement) => statement.startsWith('INSERT'))).toHaveLength(1)
  })

  it('rejects an identity already owned by another employee', async () => {
    const executeSql = sqlExecutor((statement) => {
      if (statement.includes('FROM employee_auth_identities')) {
        return [{ ...employeeRow, id: 'employee-2' }]
      }

      return []
    })

    let response
    try {
      await linkOAuthIdentity(executeSql, 'employee-1', profile, 'postgres')
    } catch (error) {
      response = toMokelayErrorResponse(error)
    }

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'BLOCK_OAUTH_ACCOUNT_CONFLICT' },
    })
  })

  it('rejects an unverified email before running SQL', async () => {
    const executeSql = vi.fn<SqlExecutor>()
    let response

    try {
      await linkOAuthIdentity(executeSql, 'employee-1', { ...profile, emailVerified: false }, 'postgres')
    } catch (error) {
      response = toMokelayErrorResponse(error)
    }

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'BLOCK_OAUTH_EMAIL_UNVERIFIED' },
    })
    expect(executeSql).not.toHaveBeenCalled()
  })
})
