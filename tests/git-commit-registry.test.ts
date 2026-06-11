import { describe, expect, it } from 'vitest'
import { allowedBlockOutputs, blockExecutors, databaseBlockFunctions } from '../src/utils/blocks/index.js'

const gitCommitOutputs = [
  'provider',
  'repo',
  'projectId',
  'branch',
  'commitSha',
  'commitUrl',
  'treeSha',
  'parentSha',
  'fileCount',
  'upsertedCount',
  'deletedCount',
]

describe('git commit block registry', () => {
  it('registers GitHub and GitLab commit blocks as non-database blocks', () => {
    expect(allowedBlockOutputs.githubCommit).toEqual(gitCommitOutputs)
    expect(allowedBlockOutputs.gitlabCommit).toEqual(gitCommitOutputs)
    expect(blockExecutors.githubCommit).toBeTypeOf('function')
    expect(blockExecutors.gitlabCommit).toBeTypeOf('function')
    expect(databaseBlockFunctions.has('githubCommit')).toBe(false)
    expect(databaseBlockFunctions.has('gitlabCommit')).toBe(false)
  })

  it('registers openAI as a non-database JSON block', () => {
    expect(allowedBlockOutputs.openAI).toEqual(['result'])
    expect(allowedBlockOutputs.analyzeDataSource).toBeUndefined()
    expect(blockExecutors.openAI).toBeTypeOf('function')
    expect(databaseBlockFunctions.has('openAI')).toBe(false)
  })
})
