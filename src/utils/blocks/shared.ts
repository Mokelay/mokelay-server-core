import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { type DatabaseType } from '../db.js'
import { mokelayError, type MokelayErrorCode } from '../mokelay-error.js'
import { conditionSchema, type OrchestrationCondition } from '../orchestration-schema.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function identifierSql(value: unknown, name: string, errorCode: MokelayErrorCode) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError(errorCode, `${name} 必须是非空字符串。`, 400)
  }

  const parts = value.trim().split('.')

  if (parts.some((part) => !part.trim())) {
    throw mokelayError(errorCode, `${name} 不是合法 SQL 标识符。`, 400)
  }

  return sql.join(parts.map((part) => sql.identifier(part.trim())), sql.raw('.'))
}

export function getFields(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((field) => typeof field === 'string' && field.trim())) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'fields 必须是非空字符串数组。', 400)
  }

  return value as string[]
}

export function getFieldValues(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'fields 必须是非空对象。', 400)
  }

  return value
}

export function getConditions(value: unknown): OrchestrationCondition[] {
  if (value === undefined) {
    return []
  }

  const parsed = z.array(conditionSchema).safeParse(value)

  if (!parsed.success) {
    throw mokelayError(
      'BLOCK_INVALID_CONDITIONS',
      `conditions 不符合规范：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
      400,
    )
  }

  return parsed.data
}

function isEmptyOptionalConditionValue(value: unknown) {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0)
}

export function buildConditionSql(condition: OrchestrationCondition): SQL | undefined {
  if (condition.group) {
    const parts = condition.groups.flatMap((item) => {
      const conditionSql = buildConditionSql(item)
      return conditionSql ? [sql`(${conditionSql})`] : []
    })

    if (parts.length === 0) {
      return undefined
    }

    return sql.join(parts, condition.groupType === 'AND' ? sql` AND ` : sql` OR `)
  }

  if (condition.optional === true && isEmptyOptionalConditionValue(condition.fieldValue)) {
    return undefined
  }

  const column = identifierSql(condition.fieldName, 'fieldName', 'BLOCK_INVALID_CONDITIONS')

  switch (condition.conditionType) {
    case 'EQ':
      return sql`${column} = ${condition.fieldValue}`
    case 'NEQ':
      return sql`${column} <> ${condition.fieldValue}`
    case 'GT':
      return sql`${column} > ${condition.fieldValue}`
    case 'GE':
      return sql`${column} >= ${condition.fieldValue}`
    case 'LT':
      return sql`${column} < ${condition.fieldValue}`
    case 'LE':
      return sql`${column} <= ${condition.fieldValue}`
    case 'IN':
    case 'NOTIN': {
      if (!Array.isArray(condition.fieldValue) || condition.fieldValue.length === 0) {
        throw mokelayError(
          'BLOCK_INVALID_CONDITION_VALUE',
          `${condition.conditionType} 条件的 fieldValue 必须是非空数组。`,
          400,
        )
      }

      const values = sql.join(condition.fieldValue.map((item) => sql`${item}`), sql`, `)
      return condition.conditionType === 'IN'
        ? sql`${column} IN (${values})`
        : sql`${column} NOT IN (${values})`
    }
  }
}

export function buildWhereSql(conditions: OrchestrationCondition[]) {
  const parts = conditions.flatMap((condition) => {
    const conditionSql = buildConditionSql(condition)
    return conditionSql ? [sql`(${conditionSql})`] : []
  })

  if (parts.length === 0) {
    return undefined
  }

  return sql.join(parts, sql` AND `)
}

export function getPositiveInteger(value: unknown, name: string, defaultValue: number, errorCode: MokelayErrorCode) {
  const parsedValue = Number(value ?? defaultValue)

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw mokelayError(errorCode, `${name} 必须是正整数。`, 400)
  }

  return parsedValue
}

export function getSessionKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_SESSION_KEY_INVALID', 'key 必须是非空字符串。', 400)
  }

  return value.trim()
}

export function normalizeR2Directory(value: unknown) {
  if (typeof value !== 'string') {
    throw mokelayError('BLOCK_R2_DIRECTORY_INVALID', 'directory 必须是非空字符串。', 400)
  }

  const directory = value.trim().replace(/^\/+|\/+$/g, '')
  const parts = directory.split('/')

  if (
    !directory
    || directory.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw mokelayError('BLOCK_R2_DIRECTORY_INVALID', 'directory 不是合法 R2 目录。', 400)
  }

  return directory
}

export function normalizeR2FileName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_R2_FILE_NAME_INVALID', 'fileName 必须是非空字符串。', 400)
  }

  const fileName = value.trim()

  if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\\')) {
    throw mokelayError('BLOCK_R2_FILE_NAME_INVALID', 'fileName 不是合法 R2 文件名。', 400)
  }

  return fileName
}

export function parseR2JsonData(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown
    } catch (error) {
      throw mokelayError('BLOCK_R2_JSON_INVALID', 'data 不是合法 JSON 字符串。', 400, error)
    }
  }

  return value
}

export function stringifyR2JsonData(value: unknown) {
  try {
    const body = JSON.stringify(value, null, 2)

    if (body === undefined) {
      throw new Error('JSON.stringify returned undefined.')
    }

    return `${body}\n`
  } catch (error) {
    throw mokelayError('BLOCK_R2_JSON_INVALID', 'data 不是可序列化的 JSON 数据。', 400, error)
  }
}

export function getCreateIdField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_INVALID_ID_FIELD', 'idField 必须是非空字符串。', 400)
  }

  const fieldName = value.trim()

  return {
    fieldName: fieldName.split('.').at(-1)?.trim() || fieldName,
    fieldSql: identifierSql(fieldName, 'idField', 'BLOCK_INVALID_ID_FIELD'),
  }
}

export function fieldValueSql(value: unknown, databaseType: DatabaseType) {
  if (!Array.isArray(value) && !isRecord(value)) {
    return sql`${value}`
  }

  const jsonValue = JSON.stringify(value)

  return databaseType === 'postgres'
    ? sql`${jsonValue}::jsonb`
    : sql`${jsonValue}`
}

export function countExpressionSql(databaseType: DatabaseType) {
  return databaseType === 'postgres'
    ? sql`count(*)::int`
    : sql`count(*)`
}

export function normalizeCountTotal(value: unknown) {
  const total = Number(value ?? 0)

  return Number.isFinite(total) ? total : 0
}

export function isPresentId(value: unknown) {
  return value !== undefined
    && value !== null
    && value !== ''
    && value !== 0
    && (typeof value !== 'bigint' || value !== BigInt(0))
}

export function isDuplicateRecordError(error: unknown) {
  if (!isRecord(error)) {
    return false
  }

  return error.code === '23505'
    || error.code === 'ER_DUP_ENTRY'
    || error.code === 1062
    || error.errno === 1062
}

export function orderBySql(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw mokelayError('BLOCK_INVALID_ORDER_BY', 'orderBy 必须是数组。', 400)
  }

  const orders = value.map((item) => {
    if (!isRecord(item) || typeof item.fieldName !== 'string' || !item.fieldName.trim()) {
      throw mokelayError('BLOCK_INVALID_ORDER_BY_FIELD', 'orderBy.fieldName 必须是非空字符串。', 400)
    }

    const direction = typeof item.direction === 'string' ? item.direction.toUpperCase() : 'ASC'

    if (direction !== 'ASC' && direction !== 'DESC') {
      throw mokelayError('BLOCK_INVALID_ORDER_BY_DIRECTION', 'orderBy.direction 只能是 ASC 或 DESC。', 400)
    }

    return sql`${identifierSql(item.fieldName, 'orderBy.fieldName', 'BLOCK_INVALID_ORDER_BY_FIELD')} ${sql.raw(direction)}`
  })

  return orders.length > 0 ? sql.join(orders, sql`, `) : undefined
}

export function requireDatabaseType(databaseType: DatabaseType | undefined) {
  if (!databaseType) {
    throw mokelayError('BLOCK_SQL_UNSUPPORTED', '数据库 Block 缺少数据库类型。', 500)
  }

  return databaseType
}
