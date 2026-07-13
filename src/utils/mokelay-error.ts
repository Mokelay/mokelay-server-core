import { createError, isError } from 'h3'
import type { MokelayDebugResponse } from './orchestration-schema.js'

export const mokelayErrorCodes = [
  'API_JSON_UUID_INVALID',
  'API_JSON_NOT_FOUND',
  'API_JSON_INVALID_JSON',
  'API_JSON_INVALID_SCHEMA',
  'API_JSON_UUID_MISMATCH',
  'API_JSON_DUPLICATE_UUID',
  'API_JSON_INVALID_FLOW',
  'API_JSON_INVALID_RESPONSE',
  'REQUEST_METHOD_MISMATCH',
  'REQUEST_PARAMETER_MISSING',
  'REQUEST_INVALID_BODY',
  'TEMPLATE_PATH_INVALID',
  'TEMPLATE_VARIABLE_NOT_FOUND',
  'TEMPLATE_ARRAY_INDEX_INVALID',
  'BLOCK_UNSUPPORTED_FUNCTION',
  'BLOCK_UNSUPPORTED_OUTPUT',
  'BLOCK_OUTPUT_MISSING',
  'BLOCK_INVALID_DATASOURCE',
  'BLOCK_DATASOURCE_URL_MISSING',
  'BLOCK_DATASOURCE_UNSUPPORTED_DATABASE',
  'BLOCK_INVALID_SCHEMA',
  'BLOCK_INVALID_TABLE',
  'BLOCK_INVALID_FIELDS',
  'BLOCK_INVALID_CONDITIONS',
  'BLOCK_INVALID_CONDITION_VALUE',
  'BLOCK_INVALID_ID_FIELD',
  'BLOCK_INVALID_PAGE',
  'BLOCK_INVALID_PAGE_SIZE',
  'BLOCK_INVALID_ORDER_BY',
  'BLOCK_INVALID_ORDER_BY_FIELD',
  'BLOCK_INVALID_ORDER_BY_DIRECTION',
  'BLOCK_SQL_UNSUPPORTED',
  'BLOCK_CREATE_MISSING_ID',
  'BLOCK_DUPLICATE_RECORD',
  'BLOCK_UNIQUE_CONFLICT',
  'BLOCK_RANDOM_ID_INVALID',
  'BLOCK_SESSION_KEY_INVALID',
  'BLOCK_SESSION_VALUE_MISSING',
  'BLOCK_SESSION_KEY_NOT_FOUND',
  'BLOCK_R2_CONFIG_MISSING',
  'BLOCK_R2_DIRECTORY_INVALID',
  'BLOCK_R2_FILE_NAME_INVALID',
  'BLOCK_R2_JSON_INVALID',
  'BLOCK_R2_SAVE_FAILED',
  'BLOCK_AI_INPUT_INVALID',
  'BLOCK_AI_CONFIG_MISSING',
  'BLOCK_AI_PROVIDER_FAILED',
  'BLOCK_AI_OUTPUT_INVALID',
  'BLOCK_PAGE_REFERENCE_DYNAMIC',
  'BLOCK_PAGE_REFERENCE_SOURCE_INVALID',
  'BLOCK_PAGE_REFERENCE_NOT_FOUND',
  'BLOCK_PAGE_REFERENCE_SELF',
  'BLOCK_PAGE_REFERENCE_CYCLE',
  'BLOCK_PAGE_REFERENCE_ASSERTION_MISMATCH',
  'BLOCK_PAGE_DELETE_REFERENCED',
  'BLOCK_PAGE_NOT_FOUND',
  'BLOCK_PAGE_UUID_INVALID',
  'BLOCK_PAGE_GRAPH_NOT_READY',
  'BLOCK_APIFOX_INPUT_INVALID',
  'BLOCK_APIFOX_CONFIG_MISSING',
  'BLOCK_APIFOX_REQUEST_FAILED',
  'BLOCK_APIFOX_RESPONSE_INVALID',
  'BLOCK_OAUTH_INPUT_INVALID',
  'BLOCK_OAUTH_CONFIG_MISSING',
  'BLOCK_OAUTH_STATE_INVALID',
  'BLOCK_OAUTH_PROVIDER_FAILED',
  'BLOCK_OAUTH_EMAIL_UNVERIFIED',
  'BLOCK_OAUTH_ACCOUNT_CONFLICT',
  'BLOCK_GIT_INPUT_INVALID',
  'BLOCK_GIT_AUTH_FAILED',
  'BLOCK_GIT_BRANCH_NOT_FOUND',
  'BLOCK_GIT_HEAD_MISMATCH',
  'BLOCK_GIT_REQUEST_FAILED',
  'CONTROLLER_UNSUPPORTED_FUNCTION',
  'CONTROLLER_INVALID_INPUTS',
  'CONTROLLER_INVALID_NODES',
  'PROCESSOR_UNSUPPORTED',
  'PROCESSOR_INVALID_CONFIG',
  'PROCESSOR_VALIDATION_FAILED',
  'SESSION_SECRET_NOT_CONFIGURED',
  'INTERNAL_ERROR',
] as const

export type MokelayErrorCode = typeof mokelayErrorCodes[number]

export type MokelayErrorResponse = {
  ok: false
  error: {
    code: MokelayErrorCode
    message: string
    details?: unknown
  }
  debug?: MokelayDebugResponse
}

const mokelayErrorCodeSet = new Set<string>(mokelayErrorCodes)
const internalErrorMessage = '服务器内部错误。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMokelayErrorCode(error: unknown) {
  if (!isRecord(error) || !isRecord(error.data)) {
    return undefined
  }

  const code = error.data.code

  return typeof code === 'string' && mokelayErrorCodeSet.has(code)
    ? code as MokelayErrorCode
    : undefined
}

export function mokelayError(
  code: MokelayErrorCode,
  message: string,
  statusCode = 500,
  cause?: unknown,
  details?: unknown,
) {
  return createError({
    statusCode,
    message,
    data: { code, ...(details === undefined ? {} : { details }) },
    cause,
  })
}

export function toMokelayErrorResponse(error: unknown): MokelayErrorResponse {
  const code = getMokelayErrorCode(error)

  if (code && isRecord(error)) {
    const message = typeof error.message === 'string' && error.message
      ? error.message
      : internalErrorMessage

    const details = isRecord(error.data) ? error.data.details : undefined

    return {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    }
  }

  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: internalErrorMessage,
    },
  }
}
