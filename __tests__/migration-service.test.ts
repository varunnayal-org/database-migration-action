/* eslint-disable jest/valid-title, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */

import * as core from '@actions/core'
import { VaultClient } from '../src/client/vault/types'
import { GHClient, PullRequest } from '../src/types.gha'
import { JiraClient, JiraIssue } from '../src/types.jira'
import { Builder, Config, MigrationMeta, Notifier, NotifyResponse } from '../src/types'
import MigrationService from '../src/migration.service'
import { LINT_CODE_DEFAULT_PREFIXES } from '../src/constants'
import * as c from './common'
import * as migration from '../src/migration/migration'
import {
  AtlasLintResponse,
  AtlasMigrationExecutionResponse,
  AtlasVersionExecution,
  VersionExecution
} from '../src/migration/atlas-class'

let coreSetFailed: jest.SpyInstance
let coreError: jest.SpyInstance

function buildVault(): VaultClient {
  return {
    getSecrets: jest.fn()
  }
}

function buildGithub(): GHClient {
  return {
    setOrg: jest.fn(),
    getUserForTeams: jest.fn().mockResolvedValue(c.getTeamByName()),
    getChangedFiles: jest.fn(),
    getPRInformation: jest.fn(),
    getPullRequestApprovedUserList: jest.fn(),
    addLabel: jest.fn(),
    closePR: jest.fn(),
    updateComment: jest.fn(),
    addComment: jest.fn()
  }
}

function buildJira(): JiraClient {
  return {
    addComment: jest.fn(),
    findIssue: jest.fn(),
    createIssue: jest.fn()
  }
}

function buildNotifier(): Notifier {
  return {
    notify: jest.fn()
  }
}

jest.mock('../src/migration/migration', () => {
  return {
    getDirectoryForDb: jest.fn(),
    setDryRun: jest.fn(),
    hydrateMigrationConfigList: jest.fn(),
    buildMigrationConfigList: jest.fn(),
    runMigrationFromList: jest.fn(),
    runLintFromList: jest.fn()
  }
})

// function buildGithubClient(): GHC
describe('migration service', () => {
  let config: Config
  let vaultClient: VaultClient
  let ghClient: GHClient
  let jiraClient: JiraClient
  let notifier: Notifier
  let factory: Builder

  function getFactory(
    { v, g, j, n } = {} as {
      v: VaultClient
      g: GHClient
      j: JiraClient
      n: Notifier
    }
  ): Builder {
    return {
      getVault: jest.fn().mockReturnValue(v || vaultClient),
      getJira: jest.fn().mockReturnValue(j || jiraClient),
      getGithub: jest.fn().mockReturnValue(g || ghClient),
      getNotifier: jest.fn().mockReturnValue(n || notifier)
    }
  }

  function getSvc(): MigrationService {
    return new MigrationService(config, factory)
  }

  const mockM = (fn: string, value: any): void => {
    // eslint-disable-next-line no-extra-semi
    ;((migration as any)[fn] as jest.Mock).mockResolvedValue(value)
  }

  function getPR(skipLabel = false): PullRequest {
    return c.getPR(['user-aaa', 'user-bbb'], skipLabel ? [] : ['db-migrations'])
  }
  function getJiraIssue(): JiraIssue {
    return {
      id: '1',
      key: 'KEY-1',
      self: 'https://a.atlassian.net/browse/KEY-1',
      fields: {}
    }
  }

  function getApprovedJiraIssue(dbaApproved = true, driApproved = true): JiraIssue {
    return {
      ...getJiraIssue(),
      fields: {
        resolution: dbaApproved ? { name: 'Done' } : undefined,
        customfield_3: driApproved ? { value: 'DONE' } : undefined
      }
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()

    coreSetFailed = jest.spyOn(core, 'setFailed').mockImplementation(jest.fn())
    coreError = jest.spyOn(core, 'error').mockImplementation(jest.fn())
    // mock.restore()
    // mock(c.getMockDirectories())

    vaultClient = buildVault()
    ghClient = buildGithub()
    jiraClient = buildJira()
    notifier = buildNotifier()

    factory = getFactory()

    config = {
      serviceName: 'calculator-svc',
      baseDirectory: './abc',
      prLabel: 'db-migrations',
      approvalTeams: ['dba'],
      ownerTeams: ['svc-team', 'svc-admin-team'],
      databases: [
        {
          directory: '.',
          schema: 'public',
          envName: 'CALCULATOR_SVC_DB'
        }
      ],

      // Runtime
      baseBranch: 'main',
      allTeams: ['svc-team', 'svc-admin-team'],
      configFileName: 'db.migrations.json',
      dbSecretNameList: ['CALCULATOR_SVC_DB'],
      devDBUrl: 'postgres://localhost:5432/calculator-svc',
      lintCodePrefixes: ['DS', 'BC', 'PG'],
      lintSkipErrorLabelPrefix: 'db-migration:lint:skip:',
      jira: {
        doneValue: 'Done',
        approvalStatus: 'DONE',
        host: 'https://test.atlassian.net',
        project: 'CALC',
        issueType: 'Task',
        label: 'db-migration',
        fields: {
          pr: 'customfield_1',
          prLabel: 'GithHub PR Link',
          repo: 'customfield_2',
          driApprovals: ['customfield_3']
        }
      }
    }
  })

  afterAll(() => {
    jest.resetModules()
    // mock.restore()
  })

  it('map issue to pull request for pr comments', async () => {
    ghClient.getPRInformation = jest.fn().mockResolvedValue({
      defaultBranchRef: { name: 'master' },
      pullRequest: {
        baseRef: {
          name: 'feature-branch',
          repository: {
            id: 'xxxxx',
            name: 'calc-svc',
            url: 'https://domain.github.com/my-org/calc-svc',
            primaryLanguage: { name: 'typescript' },
            owner: { login: 'user' }
          }
        }
      }
    })

    const pr = {
      ...c.getPR(['user-aaa', 'user-bbb'], ['db-migrations']),
      base: undefined
    } as any as PullRequest
    const expectedBase = {
      ref: 'feature-branch',
      repo: {
        default_branch: 'master',
        html_url: 'https://domain.github.com/my-org/calc-svc',
        language: 'typescript',
        name: 'calc-svc',
        owner: {
          login: 'user'
        }
      }
    }

    const svc = getSvc()

    await svc.mapIssueToPullRequest(pr)

    expect(pr.base).toEqual(expectedBase)
  })

  describe('sample flow', () => {
    beforeEach(() => {
      mockM('buildMigrationConfigList', c.getMigrationConfigList())

      ghClient.getChangedFiles = jest
        .fn()
        .mockResolvedValue(Object.keys(c.getMockDirectories().migrations).map(f => `migrations/${f}`))
    })

    function buildMVER(versionExecutionList?: VersionExecution[]): AtlasVersionExecution[] {
      return (versionExecutionList || []).map(executionList =>
        AtlasVersionExecution.fromVersionExecution(executionList)
      )
    }

    function validateResponse(
      response: any,
      migrationMeta: MigrationMeta,
      jiraIssue?: JiraIssue,
      addLint = false
    ): void {
      expect(response).toEqual({
        executionResponseList: [
          {
            containsMigrations: true,
            migrations: buildMVER(c.artifacts.no_lint_error.versionExecution?.mg1)
          }
        ],
        migrationAvailable: true,
        jiraIssue: jiraIssue || getJiraIssue(),
        ignore: true
      })

      // Notified thus creating Github comment and JIRA issue
      expect(factory.getNotifier).toHaveBeenCalledTimes(1)
      expect(factory.getNotifier).toHaveBeenCalledWith(true, getPR(), migrationMeta, config, ghClient, jiraClient)
      expect(notifier.notify).toHaveBeenCalledTimes(1)
      expect(notifier.notify).toHaveBeenCalledWith({
        migrationRunListResponse: {
          migrationAvailable: true,
          executionResponseList: [
            {
              containsMigrations: true,
              migrations: buildMVER(c.artifacts.no_lint_error.versionExecution?.mg1)
            }
          ]
        },
        addMigrationRunResponseForLint: true,

        ...(addLint
          ? {
              lintResponseList: {
                fileLintResults: [],
                migrationDir: 'mg1',
                allSkipped: false,
                firstError:
                  '"[{\\"Name\\":\\"00000000000000_baseline.sql\\",\\"Text\\":\\"CREATE EXTENSION IF NOT EXISTS \\\\\\"uuid-ossp\\\\\\";\\"},{\\"Name\\":\\"20231222064834_step1.sql\\",\\"Text\\":\\"CREATE TABLE\\\\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\\\\n\\"},{\\"Name\\":\\"20231222064941_step3.sql\\",\\"Text\\":\\"--atlas:txmode none\\\\n\\\\ncreate index concurrently idx_users_email on users(email);\\\\n\\\\ncreate index concurrently idx_users_age on users(age);\\"},{\\"Name\\":\\"20231222120857_step4.sql\\",\\"Text\\":\\"-- atlas:txmode none\\\\n\\\\nCREATE TABLE\\\\n  sessions (\\\\n    id int primary key,\\\\n    user_id int not null,\\\\n    data text not null,\\\\n    created_at timestamptz not null default now ()\\\\n  );\\\\n\\\\n-- works because table is created in this version\\\\ncreate index idx_sessions_user_id on sessions(user_id);\\\\n\\\\n\\"}]"'
              }
            }
          : {})
      })
    }

    it('should create jira issue and github comment when pr is created', async () => {
      const svc = getSvc()

      mockM('runMigrationFromList', {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
        ]
      })
      mockM(
        'runLintFromList',
        AtlasLintResponse.build(
          JSON.stringify(c.artifacts.no_lint_error.lintResponseOutput.mg1),
          'mg1',
          [],
          LINT_CODE_DEFAULT_PREFIXES
        )
      )
      notifier.notify = jest.fn().mockResolvedValue({
        githubComment: {},
        jiraComment: {},
        jiraIssue: getJiraIssue()
      } as NotifyResponse)

      const response = await svc.processEvent(
        c.getPRContext({
          action: 'opened',
          after: 'xxxxx',
          before: 'aaaaaa',
          number: 1,
          organization: {
            login: 'my-org'
          },
          pull_request: getPR(),
          repository: c.getRepo(),
          sender: c.user('user-aaa')
        })
      )

      validateResponse(
        response,
        {
          eventName: 'pull_request',
          actionName: 'opened',
          source: 'pr',
          triggeredBy: c.user('user-aaa'),
          ensureJiraTicket: true,
          lintRequired: true
        },
        undefined,
        true
      )

      // Label added to PR
      expect(ghClient.addLabel).toHaveBeenCalledTimes(1)
      expect(ghClient.addLabel).toHaveBeenCalledWith(1, ['jira-ticket-created'])
    })

    // eslint-disable-next-line jest/expect-expect
    it('should not ensure jira ticket when commented', async () => {
      mockM('runMigrationFromList', {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
        ]
      })
      notifier.notify = jest.fn().mockResolvedValue({
        githubComment: {},
        jiraComment: {},
        jiraIssue: getJiraIssue()
      } as NotifyResponse)

      const svc = getSvc()

      const response = await svc.processEvent(
        c.getPRCommentContext({
          action: 'created',
          comment: c.getComment(212121, 'jira', 'user-ddd'),
          issue: getPR(),
          organization: {
            login: 'my-org'
          },
          repository: c.getRepo(),
          sender: c.user('user-aaa')
        })
      )

      validateResponse(response, {
        eventName: 'issue_comment',
        actionName: 'created',
        source: 'comment',
        triggeredBy: {
          login: 'user-aaa',
          type: 'User'
        },
        commentId: 212121,
        commentBody: 'db migrate jira',
        ensureJiraTicket: true
      })
    })

    it('should not execute migration when pr is not approved in github from a user of approvalTeams', async () => {
      // pr not approved by anyone
      ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ccc'])
      vaultClient.getSecrets = jest.fn().mockResolvedValue({
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc'
      })

      // JIRA ticket is approved
      jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
      const svc = getSvc()
      const response = await svc.processEvent(
        c.getPRCommentContext({
          action: 'created',
          comment: c.getComment(212121, '', 'user-ddd'),
          issue: getPR(),
          organization: {
            login: 'my-org'
          },
          repository: c.getRepo(),
          sender: c.user('user-aaa')
        })
      )

      const expectedErrMsg = 'PR is not approved by @my-org/dba'

      expect(response).toEqual(null)
      expect(factory.getNotifier).toHaveBeenCalledTimes(1)
      expect(factory.getNotifier).toHaveBeenCalledWith(
        false,
        getPR(),
        {
          eventName: 'issue_comment',
          actionName: 'created',
          source: 'comment',
          triggeredBy: c.user('user-aaa'),
          commentId: 212121,
          commentBody: 'db migrate'
        },
        config,
        ghClient,
        jiraClient
      )

      expect(notifier.notify).toHaveBeenCalledTimes(1)

      expect(notifier.notify).toHaveBeenCalledWith({
        migrationRunListResponse: {
          executionResponseList: [],
          migrationAvailable: false,
          errMsg: expectedErrMsg
        }
      })
      expect(coreSetFailed).toHaveBeenCalledWith(expectedErrMsg)
    })

    it('should approve the pr', async () => {
      const svc = getSvc()

      mockM('runMigrationFromList', {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
        ]
      })
      notifier.notify = jest.fn().mockResolvedValue({
        githubComment: {},
        jiraComment: {},
        jiraIssue: getJiraIssue()
      } as NotifyResponse)

      const response = await svc.processEvent(
        c.getPRReviewContext({
          action: 'submitted',
          organization: {
            login: 'my-org'
          },
          pull_request: getPR(),
          repository: c.getRepo(),
          review: c.getReview('user-aaa', 1111111),
          sender: {
            login: 'user-bbb',
            type: 'User'
          }
        })
      )

      validateResponse(response, {
        eventName: 'pull_request_review',
        actionName: 'submitted',
        skipCommentWhenNoMigrationsAvailable: true,
        source: 'review',
        triggeredBy: {
          login: 'user-bbb',
          type: 'User'
        }
      })

      expect(ghClient.addLabel).toHaveBeenCalledTimes(1)
      expect(ghClient.addLabel).toHaveBeenCalledWith(1, ['jira-ticket-created'])
    })

    it('should execute the migration', async () => {
      // pr not approved by approvalTeams
      ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ddd'])
      vaultClient.getSecrets = jest.fn().mockResolvedValue({
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc'
      })
      // JIRA ticket is approved
      jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
      mockM('runMigrationFromList', {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
        ]
      })

      const svc = getSvc()
      const response = await svc.processEvent(
        c.getPRCommentContext({
          action: 'created',
          comment: c.getComment(212121, '', 'user-ddd'),
          issue: getPR(),
          organization: {
            login: 'my-org'
          },
          repository: c.getRepo(),
          sender: c.user('user-aaa')
        })
      )

      expect(response).toEqual({
        executionResponseList: [
          {
            containsMigrations: true,
            migrations: buildMVER(c.artifacts.no_lint_error.versionExecution?.mg1)
          }
        ],
        migrationAvailable: true,
        ignore: false
      })

      // Notified thus creating Github comment and JIRA issue
      expect(factory.getNotifier).toHaveBeenCalledTimes(1)
      expect(factory.getNotifier).toHaveBeenCalledWith(
        false,
        getPR(),
        {
          eventName: 'issue_comment',
          actionName: 'created',
          source: 'comment',
          triggeredBy: { login: 'user-aaa', type: 'User' },
          commentId: 212121,
          commentBody: 'db migrate'
        },
        config,
        ghClient,
        jiraClient
      )
      expect(notifier.notify).toHaveBeenCalledTimes(1)
      expect(notifier.notify).toHaveBeenCalledWith({
        migrationRunListResponse: {
          migrationAvailable: true,
          executionResponseList: [
            {
              containsMigrations: true,
              migrations: buildMVER(c.artifacts.no_lint_error.versionExecution?.mg1)
            }
          ]
        }
      })
    })
  })

  it('should skip pr approval when pr has label missing', async () => {
    const svc = getSvc()

    const response = await svc.processEvent(
      c.getPRReviewContext({
        action: 'submitted',
        organization: {
          login: 'my-org'
        },
        pull_request: getPR(true),
        repository: c.getRepo(),
        review: c.getReview('user-aaa', 1111111),
        sender: {
          login: 'user-bbb',
          type: 'User'
        }
      })
    )

    expect(response).toEqual({ executionResponseList: [], migrationAvailable: false, ignore: true })
  })

  it('should error while executing the migration', async () => {
    const expectedErrMsg = 'some error'

    // pr not approved by approvalTeams
    ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ddd'])
    vaultClient.getSecrets = jest.fn().mockResolvedValue({
      CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc'
    })
    // JIRA ticket is approved
    jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
    mockM('runMigrationFromList', {
      migrationAvailable: true,
      executionResponseList: [AtlasMigrationExecutionResponse.fromError(expectedErrMsg)],
      errMsg: expectedErrMsg
    })

    const svc = getSvc()
    const response = await svc.processEvent(
      c.getPRCommentContext({
        action: 'created',
        comment: c.getComment(212121, '', 'user-ddd'),
        issue: getPR(),
        organization: {
          login: 'my-org'
        },
        repository: c.getRepo(),
        sender: c.user('user-aaa')
      })
    )

    expect(response).toEqual({
      executionResponseList: [{ containsMigrations: false, migrations: [], firstError: expectedErrMsg }],
      migrationAvailable: true,
      ignore: true
    })
    // // Notified thus creating Github comment and JIRA issue
    expect(factory.getNotifier).toHaveBeenCalledTimes(1)
    expect(factory.getNotifier).toHaveBeenCalledWith(
      false,
      getPR(),
      {
        eventName: 'issue_comment',
        actionName: 'created',
        source: 'comment',
        triggeredBy: { login: 'user-aaa', type: 'User' },
        commentId: 212121,
        commentBody: 'db migrate'
      },
      config,
      ghClient,
      jiraClient
    )
    expect(notifier.notify).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledWith({
      migrationRunListResponse: {
        migrationAvailable: true,
        executionResponseList: [
          {
            containsMigrations: false,
            migrations: [],
            firstError: expectedErrMsg
          }
        ],
        errMsg: expectedErrMsg
      }
    })

    expect(coreSetFailed).toHaveBeenCalledWith(expectedErrMsg)
  })

  // You add SQL files in PR. The label will be added to the PR
  // after that when PR is removed, then the gha register the error(core.error method)
  it('should error when sql files are removed from PR', async () => {
    // pr not approved by approvalTeams
    ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ddd'])
    vaultClient.getSecrets = jest.fn().mockResolvedValue({
      CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc'
    })
    // JIRA ticket is approved
    jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
    mockM('runMigrationFromList', {
      migrationAvailable: false,
      executionResponseList: []
    })

    const expectedErrMsg = 'No migrations available'

    const svc = getSvc()
    const response = await svc.processEvent(
      c.getPRCommentContext({
        action: 'created',
        comment: c.getComment(212121, '', 'user-ddd'),
        issue: getPR(),
        organization: {
          login: 'my-org'
        },
        repository: c.getRepo(),
        sender: c.user('user-aaa')
      })
    )

    expect(response).toEqual({
      executionResponseList: [],
      migrationAvailable: false,
      ignore: true
    })
    // // Notified thus creating Github comment and JIRA issue
    expect(factory.getNotifier).toHaveBeenCalledTimes(1)
    expect(factory.getNotifier).toHaveBeenCalledWith(
      false,
      getPR(),
      {
        eventName: 'issue_comment',
        actionName: 'created',
        source: 'comment',
        triggeredBy: { login: 'user-aaa', type: 'User' },
        commentId: 212121,
        commentBody: 'db migrate'
      },
      config,
      ghClient,
      jiraClient
    )
    expect(notifier.notify).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledWith({
      migrationRunListResponse: {
        migrationAvailable: false,
        executionResponseList: [],
        errMsg: expectedErrMsg
      }
    })

    expect(coreError).toHaveBeenCalledWith(expectedErrMsg)
  })
})
