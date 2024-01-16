/* eslint-disable jest/valid-title, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */

import * as github from '@actions/github'
import GithubClient from '../src/client/github'
import JiraClient from '../src/client/jira'
import { LINT_CODE_DEFAULT_PREFIXES } from '../src/constants'
import { Platform, formatterMap } from '../src/formatting/formatters'
import { TextBuilder } from '../src/formatting/text-builder'
import { AtlasLintResponse, AtlasMigrationExecutionResponse } from '../src/migration/atlas-class'
import { NotifierService } from '../src/notifier.service'
import {
  Config,
  ChangedFileValidationError,
  ITextBuilder,
  MigrationLintResponse,
  MigrationMeta,
  MigrationRunListResponse,
  NotifyParams
} from '../src/types'
import { JiraComment, JiraIssue } from '../src/types.jira'
import * as gha from '../src/types.gha'
import * as c from './common'

jest.mock('../src/client/github', () => {
  return jest.fn().mockImplementation(() => {
    return {
      addComment: jest.fn(),
      updateComment: jest.fn(),
      closePR: jest.fn()
    }
  })
})

jest.mock('../src/client/jira', () => {
  return jest.fn().mockImplementation(() => {
    return {
      findIssue: jest.fn(),
      createIssue: jest.fn(),
      addComment: jest.fn()
    }
  })
})

jest.mock('../src/formatting/text-builder', () => {
  return {
    TextBuilder: jest.fn().mockImplementation(() => {
      return {
        getFormatter: (s: Platform) => formatterMap[s],
        title: jest.fn(),
        description: jest.fn(),
        platform: {
          jira: { run: jest.fn(), lint: jest.fn(), title: jest.fn(), description: jest.fn() },
          github: { run: jest.fn(), lint: jest.fn(), title: jest.fn(), description: jest.fn() }
        }
      }
    })
  }
})

describe('NotifierService', () => {
  let mockGithubClient: jest.Mocked<GithubClient>
  let mockJiraClient: jest.Mocked<JiraClient>
  let mockTextBuilder: jest.Mocked<TextBuilder>
  let mockGithubBuilder: jest.Mocked<ITextBuilder>
  let mockJiraBuilder: jest.Mocked<ITextBuilder>

  beforeEach(() => {
    jest.clearAllMocks()
    // Create instances of the mocked classes
    mockGithubClient = new GithubClient(github.getOctokit('token')) as jest.Mocked<GithubClient>
    mockJiraClient = {
      findIssue: jest.fn(),
      createIssue: jest.fn(),
      addComment: jest.fn()
    } as any as jest.Mocked<JiraClient>

    mockTextBuilder = new TextBuilder(true, '', '', []) as jest.Mocked<TextBuilder>
    mockGithubBuilder = mockTextBuilder.platform.github as jest.Mocked<ITextBuilder>
    mockJiraBuilder = mockTextBuilder.platform.jira as jest.Mocked<ITextBuilder>
  })
  afterAll(() => {
    jest.resetModules()
  })

  const changedFileValidation: ChangedFileValidationError = {
    errMsg: 'Some error',
    unmatched: ['a.sql'],
    migrationAvailable: true
  }
  const migrationRunListResponse: MigrationRunListResponse = {
    executionResponseList: [],
    migrationAvailable: false,
    errMsg: ''
  }

  describe('buildGithubComment', () => {
    const cfValidationGithubSummary = '**Changed File Validation Error**: Some error\nUnmatched Files:\n- a.sql\n'

    it('should close the PR with comment', async () => {
      mockGithubClient.closePR.mockResolvedValueOnce({ id: 12345 } as any)

      const svc = new NotifierService(
        true,
        { number: 1 } as any,
        {} as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )

      const result = await svc.buildGithubComment(mockTextBuilder.platform.github, {
        closePR: true,
        changedFileValidation,
        migrationRunListResponse: { executionResponseList: [], migrationAvailable: false, errMsg: '' }
      })

      expect(result).toEqual({ id: 12345 })
      expect(mockGithubClient.closePR).toHaveBeenCalledTimes(1)
      expect(mockGithubClient.closePR).toHaveBeenCalledWith(1, cfValidationGithubSummary)
    })

    it('should call update comment', async () => {
      mockGithubClient.updateComment.mockResolvedValueOnce({ id: 12345, body: 'sample' } as any)
      mockGithubBuilder.run.mockReturnValueOnce('run comment text')

      const commentBody = 'db migrate dry-run'
      const svc = new NotifierService(
        true,
        { number: 1 } as any,
        { commentId: '111', commentBody } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )
      const response = await svc.buildGithubComment(mockTextBuilder.platform.github, {
        closePR: false,
        migrationRunListResponse: {
          migrationAvailable: true,
          executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.successful_migration)],
          errMsg: undefined
        }
      })

      expect(response).toEqual({ id: 12345, body: 'sample' })
      expect(mockGithubBuilder.run).toHaveBeenCalledTimes(1)
      expect(mockGithubBuilder.run).toHaveBeenCalledWith({
        migrationAvailable: true,
        executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.successful_migration)],
        errMsg: undefined
      })
      expect(mockGithubClient.updateComment).toHaveBeenCalledTimes(1)
      expect(mockGithubClient.updateComment).toHaveBeenCalledWith('111', `${commentBody}\r\n\r\nrun comment text`)
    })

    it('should call add comment', async () => {
      mockGithubClient.addComment.mockResolvedValueOnce({ id: 12345, body: 'add comment' } as any)

      const svc = new NotifierService(
        true,
        { number: 1 } as any,
        { eventName: 'issue_comment', actionName: 'created', triggeredBy: { login: 'user1' } } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )
      const response = await svc.buildGithubComment(mockTextBuilder.platform.github, {
        closePR: false,
        changedFileValidation,
        migrationRunListResponse: { executionResponseList: [], migrationAvailable: false, errMsg: '' }
      })

      expect(response).toEqual({ id: 12345, body: 'add comment' })
      expect(mockGithubClient.addComment).toHaveBeenCalledTimes(1)
      expect(mockGithubClient.addComment).toHaveBeenCalledWith(
        1,
        `Executed By: @user1\r\nReason: issue_comment.created\r\n${cfValidationGithubSummary}`
      )
    })

    it('should call add comment with jira ticket', async () => {
      mockGithubClient.addComment.mockResolvedValueOnce({ id: 12345, body: 'add comment' } as any)

      const svc = new NotifierService(
        true,
        { number: 1 } as any,
        { eventName: 'issue_comment', actionName: 'created', triggeredBy: { login: 'user1' } } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )
      const response = await svc.buildGithubComment(mockTextBuilder.platform.github, {
        closePR: false,
        changedFileValidation,
        jiraIssue: { key: 'KEY-1', id: '1', self: 'http://jira.com', fields: {} },
        migrationRunListResponse: { executionResponseList: [], migrationAvailable: false, errMsg: '' }
      })

      expect(response).toEqual({ id: 12345, body: 'add comment' })
      expect(mockGithubClient.addComment).toHaveBeenCalledTimes(1)
      expect(mockGithubClient.addComment).toHaveBeenCalledWith(
        1,
        `Executed By: @user1\r\nReason: issue_comment.created\r\nJIRA Ticket: KEY-1\r\n${cfValidationGithubSummary}`
      )
    })

    it('should call add lint comment with migration execution comment', async () => {
      mockGithubClient.addComment.mockResolvedValueOnce({ id: 12345, body: 'add comment' } as any)
      mockGithubBuilder.lint.mockReturnValueOnce('lint comment text')
      mockGithubBuilder.run.mockReturnValueOnce('run comment text')

      const svc = new NotifierService(
        true,
        { number: 1 } as any,
        { eventName: 'issue_comment', actionName: 'created', triggeredBy: { login: 'user1' } } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )
      const response = await svc.buildGithubComment(mockTextBuilder.platform.github, {
        closePR: false,
        addMigrationRunResponseForLint: true,
        migrationRunListResponse: {
          migrationAvailable: true,
          executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.successful_migration)],
          errMsg: undefined
        },
        lintResponseList: {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'Not used',
          canSkipAllErrors: false
        }
      })

      expect(response).toEqual({ id: 12345, body: 'add comment' })
      expect(mockGithubBuilder.lint).toHaveBeenCalledTimes(1)
      expect(mockGithubBuilder.lint).toHaveBeenCalledWith([
        AtlasLintResponse.build(
          c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
          'mg1',
          [],
          LINT_CODE_DEFAULT_PREFIXES
        )
      ])
      expect(mockGithubBuilder.run).toHaveBeenCalledTimes(1)
      expect(mockGithubBuilder.run).toHaveBeenCalledWith({
        migrationAvailable: true,
        executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.successful_migration)],
        errMsg: undefined
      })

      expect(mockGithubClient.addComment).toHaveBeenCalledTimes(1)
      expect(mockGithubClient.addComment).toHaveBeenCalledWith(
        1,
        'Executed By: @user1\r\nReason: issue_comment.created\r\nlint comment text\r\n\r\nrun comment text'
      )
    })
  })

  describe('buildJiraComment', () => {
    let jiraIssue: JiraIssue
    let jiraComment: JiraComment
    let lintResponseList: MigrationLintResponse

    beforeEach(() => {
      jiraIssue = { key: 'KEY-1', id: '1', self: 'http://jira.com', fields: {} }
      jiraComment = { id: '123', self: 'http:/jira.com', body: 'comment' }
      lintResponseList = {
        lintResponseList: [
          AtlasLintResponse.build(
            c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
            'mg1',
            [],
            LINT_CODE_DEFAULT_PREFIXES
          )
        ],
        errMsg: 'Not used',
        canSkipAllErrors: false
      }
    })

    describe('skip jira integration', () => {
      const testCases: {
        name: string
        svcArgs: [boolean, gha.PullRequest, MigrationMeta, Config]
        migrationRunListResponse: MigrationRunListResponse
        noJiraClient?: boolean
        changedFileValidation?: ChangedFileValidationError
        jiraIssue?: JiraIssue | null
      }[] = [
        {
          name: 'dry run true and jira not required',
          svcArgs: [true, { number: 1 } as any, { ensureJiraTicket: false } as any, {} as any],
          changedFileValidation: undefined,
          migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
          jiraIssue
        },
        {
          name: 'changed file validation error',
          svcArgs: [true, { number: 1 } as any, { ensureJiraTicket: true } as any, {} as any],
          changedFileValidation,
          migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
          jiraIssue
        },
        {
          name: 'jira ticket not required',
          svcArgs: [true, { number: 1 } as any, {} as any, {} as any],
          changedFileValidation: undefined,
          migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
          jiraIssue
        },
        {
          name: 'migration not available',
          svcArgs: [true, { number: 1 } as any, { ensureJiraTicket: true } as any, {} as any],
          changedFileValidation: undefined,
          migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: false },
          jiraIssue
        },
        {
          name: 'no jira issue and no migration lint error message',
          svcArgs: [true, { number: 1 } as any, { ensureJiraTicket: true } as any, {} as any],
          changedFileValidation: undefined,
          migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true, errMsg: 'lint error' }
        },
        {
          name: 'jira client missing on missing jira config',
          svcArgs: [true, { number: 1 } as any, { ensureJiraTicket: true } as any, {} as any],
          changedFileValidation: undefined,
          migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
          jiraIssue,
          noJiraClient: true
        }
      ]

      for (const tc of testCases) {
        const {
          migrationRunListResponse: runListResponse,
          svcArgs,
          changedFileValidation: cfValidation,
          jiraIssue: jira,
          noJiraClient
        } = tc
        it(tc.name, async () => {
          const svc = new NotifierService(
            svcArgs[0],
            svcArgs[1],
            svcArgs[2],
            svcArgs[3],
            mockGithubClient,
            !noJiraClient ? mockJiraClient : null
          )

          const result = await svc.buildJiraComment(mockTextBuilder.platform.jira, {
            changedFileValidation: cfValidation,
            migrationRunListResponse: runListResponse,
            jiraIssue: jira
          })

          expect(result).toEqual([Promise.resolve(undefined), Promise.resolve(undefined)])
        })
      }
    })

    it('should create issue', async () => {
      mockJiraClient.createIssue.mockResolvedValueOnce(jiraIssue)
      mockJiraClient.addComment.mockResolvedValue(jiraComment)
      mockJiraBuilder.lint.mockReturnValueOnce('jira comment text')
      mockJiraBuilder.description.mockImplementationOnce((s: string) => `${s}: some description`)
      mockJiraBuilder.title.mockReturnValueOnce('some title')

      const prHtmlUrl = 'http://pr.com'

      const svc = new NotifierService(
        true,
        { number: 1, html_url: prHtmlUrl, base: { repo: { html_url: 'http://repo.com' } } } as any,
        { ensureJiraTicket: true } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )

      const result = await svc.buildJiraComment(mockTextBuilder.platform.jira, {
        migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
        jiraIssue: null,
        lintResponseList
      })

      expect(result).toEqual([Promise.resolve(jiraIssue), Promise.resolve(jiraComment)])

      expect(mockJiraClient.addComment).toHaveBeenCalledTimes(0)
      expect(mockJiraClient.createIssue).toHaveBeenCalledTimes(1)
      expect(mockJiraClient.createIssue).toHaveBeenCalledTimes(1)
      expect(mockJiraClient.createIssue).toHaveBeenCalledWith({
        description: 'jira comment text: some description',
        prLink: 'http://pr.com',
        prNumber: 1,
        repoLink: 'http://repo.com',
        title: 'some title'
      })
    })

    it('should find issue and add comment', async () => {
      mockJiraClient.findIssue.mockResolvedValueOnce(jiraIssue)
      mockJiraClient.addComment.mockResolvedValue(jiraComment)
      mockJiraBuilder.lint.mockReturnValueOnce('jira comment text')

      const prHtmlUrl = 'http://pr.com'

      const svc = new NotifierService(
        true,
        { number: 1, html_url: prHtmlUrl } as any,
        { ensureJiraTicket: true } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )

      const result = await svc.buildJiraComment(mockTextBuilder.platform.jira, {
        migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
        jiraIssue: undefined,
        lintResponseList
      })

      expect(result).toEqual([Promise.resolve(jiraIssue), Promise.resolve(jiraComment)])
      expect(mockJiraClient.createIssue).toHaveBeenCalledTimes(0)
      expect(mockJiraClient.findIssue).toHaveBeenCalledTimes(1)
      expect(mockJiraClient.findIssue).toHaveBeenCalledWith(prHtmlUrl)
      expect(mockJiraClient.addComment).toHaveBeenCalledTimes(1)
      expect(mockJiraClient.addComment).toHaveBeenCalledWith(jiraIssue.id, 'jira comment text')
    })

    it('should add comment when jira issue is passed', async () => {
      mockJiraClient.addComment.mockResolvedValue(jiraComment)
      mockJiraBuilder.lint.mockReturnValueOnce('jira comment text')
      mockJiraBuilder.description.mockImplementationOnce((s: string) => `${s}: some description`)
      mockJiraBuilder.title.mockReturnValueOnce('some title')

      const svc = new NotifierService(
        true,
        { number: 1, html_url: 'http://pr.com', base: { repo: { html_url: 'http://repo.com' } } } as any,
        { ensureJiraTicket: true } as any,
        {} as any,
        mockGithubClient,
        mockJiraClient
      )

      const result = await svc.buildJiraComment(mockTextBuilder.platform.jira, {
        migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
        lintResponseList,
        jiraIssue: { ...jiraIssue, fields: { ...jiraIssue.fields } }
      })

      expect(result).toEqual([Promise.resolve(jiraIssue), Promise.resolve(jiraComment)])
      expect(mockJiraClient.createIssue).toHaveBeenCalledTimes(0)
      expect(mockJiraClient.findIssue).toHaveBeenCalledTimes(0)
      expect(mockJiraClient.addComment).toHaveBeenCalledTimes(1)
      expect(mockJiraClient.addComment).toHaveBeenCalledWith(jiraIssue.id, 'jira comment text')
    })
  })

  describe('notify', () => {
    let svc: NotifierService
    let notifyParams: NotifyParams
    let mockBuildGithubComment: jest.MockedFunction<any>
    let mockBuildJiraComment: jest.MockedFunction<any>

    beforeEach(() => {
      mockBuildGithubComment = jest.fn()
      mockBuildJiraComment = jest.fn()

      svc = new NotifierService(
        true,
        { number: 1, html_url: 'http://pr.com', base: { repo: { html_url: 'http://repo.com' } } } as any,
        {} as any,
        {
          baseDirectory: 'migrations',
          databases: [{ directory: '.' }]
        } as any,
        mockGithubClient,
        mockJiraClient
      )

      notifyParams = {
        migrationRunListResponse: { ...migrationRunListResponse, migrationAvailable: true },
        lintResponseList: {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'Not used',
          canSkipAllErrors: false
        }
      }
    })

    it('should call buildGithubComment and buildJiraComment', async () => {
      svc.buildGithubComment = mockBuildGithubComment
      svc.buildJiraComment = mockBuildJiraComment.mockResolvedValueOnce([
        Promise.resolve(undefined),
        Promise.resolve(undefined)
      ])

      await svc.notify(notifyParams)

      expect(mockBuildGithubComment).toHaveBeenCalledTimes(1)
      // Cannot have these checks as mocking TextBuilder and notify creates a new instance of TextBuilder
      expect(mockBuildGithubComment).toHaveBeenCalledWith(expect.anything(), notifyParams)

      expect(mockBuildJiraComment).toHaveBeenCalledTimes(1)
      expect(mockBuildJiraComment).toHaveBeenCalledWith(expect.anything(), notifyParams)
    })

    describe('should throw error if github or jira fails', () => {
      const testCases: { name: string; setupMock: () => void }[] = [
        {
          name: 'github',
          setupMock: () => {
            svc.buildGithubComment = jest.fn().mockRejectedValueOnce(new Error('github'))
            svc.buildJiraComment = mockBuildJiraComment.mockResolvedValueOnce([
              Promise.resolve(undefined),
              Promise.resolve(undefined)
            ])
          }
        },
        {
          name: 'jira issue creation',
          setupMock: () => {
            svc.buildGithubComment = mockBuildGithubComment
            svc.buildJiraComment = mockBuildJiraComment.mockResolvedValueOnce([
              Promise.reject(new Error('jira issue creation')),
              Promise.resolve(undefined)
            ])
          }
        },
        {
          name: 'jira comment creation',
          setupMock: () => {
            svc.buildGithubComment = mockBuildGithubComment
            svc.buildJiraComment = mockBuildJiraComment.mockResolvedValueOnce([
              Promise.resolve(undefined),
              Promise.reject(new Error('jira comment creation'))
            ])
          }
        }
      ]

      for (const tc of testCases) {
        it(tc.name, async () => {
          tc.setupMock()
          await expect(svc.notify(notifyParams)).rejects.toThrow(tc.name)
        })
      }
    })
  })
})
