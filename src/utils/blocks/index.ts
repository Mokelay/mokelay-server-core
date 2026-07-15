import { type BlockDefinition, type BlockExecutor } from '../orchestration-schema.js'
import { executeAddSessionBlock } from './addSession.js'
import { executeAssertUniqueBlock } from './assertUnique.js'
import { executeCountBlock } from './count.js'
import { executeCreateBlock } from './create.js'
import { executeCreateSchemaBlock } from './createSchema.js'
import { executeDeleteBlock } from './delete.js'
import { executeFragmentBlock } from './executeFragment.js'
import { executeGithubCommitBlock } from './githubCommit.js'
import { executeGitlabCommitBlock } from './gitlabCommit.js'
import { gitCommitOutputKeys } from './gitShared.js'
import { executeListApifoxApisBlock } from './listApifoxApis.js'
import { executeListApifoxProjectsBlock } from './listApifoxProjects.js'
import { executeListBlock } from './list.js'
import { executeLinkOAuthIdentityBlock } from './linkOAuthIdentity.js'
import { executeOpenAIBlock } from './openAI.js'
import { executeOAuthAuthorizeUrlBlock } from './oauthAuthorizeUrl.js'
import { executeOAuthCallbackBlock } from './oauthCallback.js'
import { executePageBlock } from './page.js'
import { executeReadBlock } from './read.js'
import { executeReadSessionBlock } from './readSession.js'
import { executeRemoveSessionBlock } from './removeSession.js'
import { executeRandomIdBlock } from './randomId.js'
import { executeSaveJsonToR2Block } from './saveJsonToR2.js'
import { executeSchemaBlock } from './schema.js'
import { executeUpdateBlock } from './update.js'
import { executeUpsertBlock } from './upsert.js'

export const blockDefinitions: Readonly<Record<string, BlockDefinition>> = {
  list: { executor: executeListBlock, allowedOutputs: ['datas'], requiresDatasource: true },
  page: {
    executor: executePageBlock,
    allowedOutputs: ['datas', 'total', 'totalPages', 'page', 'pageSize', 'hasPreviousPage', 'hasNextPage'],
    requiresDatasource: true,
  },
  count: { executor: executeCountBlock, allowedOutputs: ['total'], requiresDatasource: true },
  read: { executor: executeReadBlock, allowedOutputs: ['data'], requiresDatasource: true },
  delete: { executor: executeDeleteBlock, allowedOutputs: ['affected'], requiresDatasource: true },
  executeFragment: { executor: executeFragmentBlock, allowedOutputs: ['result'] },
  create: { executor: executeCreateBlock, allowedOutputs: ['uuid'], requiresDatasource: true },
  createSchema: { executor: executeCreateSchemaBlock, allowedOutputs: ['schema', 'created', 'exists'], requiresDatasource: true },
  upsert: { executor: executeUpsertBlock, allowedOutputs: ['uuid'], requiresDatasource: true },
  assertUnique: { executor: executeAssertUniqueBlock, allowedOutputs: [], requiresDatasource: true },
  update: { executor: executeUpdateBlock, allowedOutputs: ['affected'], requiresDatasource: true },
  schema: { executor: executeSchemaBlock, allowedOutputs: ['tables'], requiresDatasource: true },
  addSession: { executor: executeAddSessionBlock, allowedOutputs: [] },
  removeSession: { executor: executeRemoveSessionBlock, allowedOutputs: [] },
  readSession: { executor: executeReadSessionBlock, allowedOutputs: ['value'] },
  randomId: { executor: executeRandomIdBlock, allowedOutputs: ['value'] },
  saveJsonToR2: {
    executor: executeSaveJsonToR2Block,
    allowedOutputs: ['key', 'directory', 'fileName', 'bucket', 'size', 'etag', 'skipped'],
  },
  oauthAuthorizeUrl: {
    executor: executeOAuthAuthorizeUrlBlock,
    allowedOutputs: ['redirectUrl', 'provider', 'state'],
  },
  oauthCallback: {
    executor: executeOAuthCallbackBlock,
    allowedOutputs: [
      'user',
      'isNewUser',
      'linkedIdentity',
      'requiresRegistration',
      'registration',
      'provider',
      'redirectUrl',
      'errorCode',
    ],
    requiresDatasource: true,
  },
  linkOAuthIdentity: {
    executor: executeLinkOAuthIdentityBlock,
    allowedOutputs: ['user', 'linkedIdentity'],
    requiresDatasource: true,
  },
  openAI: { executor: executeOpenAIBlock, allowedOutputs: ['result'] },
  listApifoxApis: { executor: executeListApifoxApisBlock, allowedOutputs: ['apis', 'count', 'openapi'] },
  listApifoxProjects: {
    executor: executeListApifoxProjectsBlock,
    allowedOutputs: ['projects', 'count', 'raw'],
  },
  githubCommit: { executor: executeGithubCommitBlock, allowedOutputs: gitCommitOutputKeys },
  gitlabCommit: { executor: executeGitlabCommitBlock, allowedOutputs: gitCommitOutputKeys },
}

export const allowedBlockOutputs = Object.fromEntries(
  Object.entries(blockDefinitions).map(([functionName, definition]) => [functionName, definition.allowedOutputs]),
) as Record<string, readonly string[]>

export const blockExecutors = Object.fromEntries(
  Object.entries(blockDefinitions).map(([functionName, definition]) => [functionName, definition.executor]),
) as Record<string, BlockExecutor>

export const databaseBlockFunctions = new Set(
  Object.entries(blockDefinitions)
    .filter(([, definition]) => definition.requiresDatasource)
    .map(([functionName]) => functionName),
)
