import { type BlockExecutor } from '../orchestration-schema.js'
import { executeAddSessionBlock } from './addSession.js'
import { executeAnalyzeDataSourceBlock } from './analyzeDataSource.js'
import { executeAssertUniqueBlock } from './assertUnique.js'
import { executeCountBlock } from './count.js'
import { executeCreateBlock } from './create.js'
import { executeDeleteBlock } from './delete.js'
import { executeListApifoxApisBlock } from './listApifoxApis.js'
import { executeListBlock } from './list.js'
import { executePageBlock } from './page.js'
import { executeReadBlock } from './read.js'
import { executeReadSessionBlock } from './readSession.js'
import { executeRemoveSessionBlock } from './removeSession.js'
import { executeSaveJsonToR2Block } from './saveJsonToR2.js'
import { executeSchemaBlock } from './schema.js'
import { executeUpdateBlock } from './update.js'
import { executeUpsertBlock } from './upsert.js'

export const allowedBlockOutputs: Record<string, readonly string[]> = {
  list: ['datas'],
  page: ['datas', 'total', 'totalPages', 'page', 'pageSize', 'hasPreviousPage', 'hasNextPage'],
  count: ['total'],
  read: ['data'],
  delete: ['affected'],
  create: ['uuid'],
  upsert: ['uuid'],
  assertUnique: [],
  update: ['affected'],
  schema: ['tables'],
  addSession: [],
  removeSession: [],
  readSession: ['value'],
  saveJsonToR2: ['key', 'directory', 'fileName', 'bucket', 'size', 'etag', 'skipped'],
  analyzeDataSource: ['result'],
  listApifoxApis: ['apis', 'count', 'openapi'],
}

export const databaseBlockFunctions = new Set([
  'list',
  'page',
  'count',
  'read',
  'delete',
  'create',
  'upsert',
  'assertUnique',
  'update',
  'schema',
])

export const blockExecutors: Record<string, BlockExecutor> = {
  list: executeListBlock,
  page: executePageBlock,
  count: executeCountBlock,
  read: executeReadBlock,
  delete: executeDeleteBlock,
  create: executeCreateBlock,
  upsert: executeUpsertBlock,
  assertUnique: executeAssertUniqueBlock,
  update: executeUpdateBlock,
  schema: executeSchemaBlock,
  addSession: executeAddSessionBlock,
  removeSession: executeRemoveSessionBlock,
  readSession: executeReadSessionBlock,
  saveJsonToR2: executeSaveJsonToR2Block,
  analyzeDataSource: executeAnalyzeDataSourceBlock,
  listApifoxApis: executeListApifoxApisBlock,
}
