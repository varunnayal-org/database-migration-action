/* eslint-disable jest/valid-title, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */

import * as core from '@actions/core'
import { VaultClient } from '../src/client/vault/types'
import { ContextSchedule, GHClient, PullRequest } from '../src/types.gha'
import { JiraClient, JiraIssue, Config as JIRAConfig } from '../src/types.jira'
import { Builder, Config, MigrationLintResponse, MigrationMeta, Notifier, NotifyResponse } from '../src/types'
import MigrationService from '../src/migration.service'
import { LINT_CODE_DEFAULT_PREFIXES } from '../src/constants'
import * as c from './common'
import * as migration from '../src/migration/migration'
import {
  AtlasDriftResponse,
  AtlasLintResponse,
  AtlasMigrationExecutionResponse,
  AtlasVersionExecution,
  VersionExecution
} from '../src/migration/atlas-class'

let coreSetFailed: jest.SpyInstance

function buildVault(): VaultClient {
  return {
    getSecrets: jest.fn()
  }
}

function buildGithub(): GHClient {
  return {
    setOrg: jest.fn().mockRejectedValue('Method setOrg should not have been called'),
    getUserForTeams: jest.fn().mockResolvedValue(c.getTeamByName()),
    getChangedFiles: jest.fn().mockRejectedValue('Method getChangedFiles should not have been called'),
    getPRInformation: jest.fn().mockRejectedValue('Method getPRInformation should not have been called'),
    getPullRequestApprovedUserList: jest
      .fn()
      .mockRejectedValue('Method getPullRequestApprovedUserList should not have been called'),
    addLabel: jest.fn().mockRejectedValue('Method addLabel should not have been called'),
    closePR: jest.fn().mockRejectedValue('Method closePR should not have been called'),
    updateComment: jest.fn().mockRejectedValue('Method updateComment should not have been called'),
    addComment: jest.fn().mockRejectedValue('Method addComment should not have been called')
  }
}

function buildJira(): JiraClient {
  return {
    addComment: jest.fn().mockRejectedValue('Method addComment should not have been called'),
    findIssue: jest.fn().mockRejectedValue('Method findIssue should not have been called'),
    findSchemaDriftIssue: jest.fn().mockRejectedValue('Method findSchemaDriftIssue should not have been called'),
    createIssue: jest.fn().mockRejectedValue('Method createIssue should not have been called')
  }
}

function buildNotifier(): Notifier {
  return {
    notify: jest.fn().mockRejectedValue('Method notify should not have been called'),
    drift: jest.fn().mockRejectedValue('Method drift should not have been called')
  }
}

jest.mock('../src/migration/migration', () => {
  return {
    getDirectoryForDb: jest.fn(),
    setDryRun: jest.fn(),
    hydrateMigrationConfigList: jest.fn(),
    buildMigrationConfigList: jest.fn(),
    runMigrationFromList: jest.fn(),
    runLintFromList: jest.fn(),
    runSchemaDriftFromList: jest.fn()
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
      getJira: jest.fn().mockImplementation((jiraConfig: JIRAConfig) => {
        if (!jiraConfig) {
          return null
        }
        return j || jiraClient
      }),
      getGithub: jest.fn().mockReturnValue(g || ghClient),
      getNotifier: jest.fn().mockReturnValue(n || notifier)
    }
  }

  function getSvc(
    {
      jiraConfig
    }: {
      jiraConfig: undefined | null // null for ignoring jira integration
    } = { jiraConfig: undefined }
  ): MigrationService {
    const usedConfig = {
      ...config
    }
    if (jiraConfig === null) {
      usedConfig.jira = undefined
    }
    return new MigrationService(usedConfig, factory)
  }

  const mockM = (fn: string, value: any): void => {
    // eslint-disable-next-line no-extra-semi
    ;((migration as any)[fn] as jest.Mock).mockResolvedValue(value)
  }

  function getPR(skipLabel: boolean | string[] = false): PullRequest {
    return c.getPR(['user-aaa', 'user-bbb'], Array.isArray(skipLabel) ? skipLabel : skipLabel ? [] : ['db-migration'])
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

    vaultClient = buildVault()
    ghClient = buildGithub()
    jiraClient = buildJira()
    notifier = buildNotifier()

    factory = getFactory()

    config = {
      serviceName: 'calculator-svc',
      baseDirectory: './abc',
      prLabel: 'db-migration',
      approvalTeams: ['dba'],
      ownerTeams: ['svc-team', 'svc-admin-team'],
      databases: [
        {
          directory: '.',
          envName: 'CALCULATOR_SVC_DB',
          revisionSchema: 'public'
        }
      ],

      // Runtime
      baseBranch: 'main',
      allTeams: ['svc-team', 'svc-admin-team'],
      configFileName: 'db.migrations.json',
      dbSecretNameList: ['CALCULATOR_SVC_DB'],
      devDBUrl: 'postgres://localhost:5432/calculator-svc?search_path=public',
      lintCodePrefixes: ['DS', 'BC', 'PG'],
      lintSkipErrorLabelPrefix: 'db-migration:lint:skip:',
      jira: {
        doneValue: 'Done',
        approvalStatus: 'DONE',
        host: 'https://test.atlassian.net',
        project: 'CALC',
        issueType: 'Task',
        label: 'db-migration',
        schemaDriftLabel: 'db-schema-drift',
        schemaDriftIssueType: 'Bug',
        fields: {
          pr: 'customfield_1',
          prLabel: 'GithHub PR Link',
          repo: 'customfield_2',
          repoLabel: 'Code Repository Link',
          driApprovals: ['customfield_3']
        }
      }
    }
  })

  afterAll(() => {
    jest.resetModules()
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
      ...c.getPR(['user-aaa', 'user-bbb'], ['db-migration']),
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

  describe('processEvent', () => {
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
        pr = getPR(),
        addLint: boolean | MigrationLintResponse = false,
        jiraIssue: JiraIssue | undefined = undefined
      ): void {
        const expectedExecutionResponseList = [
          {
            containsMigrations: true,
            migrations: buildMVER(c.artifacts.no_lint_error.versionExecution?.mg1)
          }
        ]
        expect(response).toEqual({
          executionResponseList: expectedExecutionResponseList,
          migrationAvailable: true,
          jiraIssue: jiraIssue || getJiraIssue(),
          ignore: true
        })

        // Notified thus creating Github comment and JIRA issue
        expect(factory.getNotifier).toHaveBeenCalledTimes(1)
        expect(factory.getNotifier).toHaveBeenCalledWith(true, config, ghClient, jiraClient)
        expect(notifier.notify).toHaveBeenCalledTimes(1)
        expect(notifier.notify).toHaveBeenCalledWith({
          pr,
          migrationMeta,
          migrationRunListResponse: {
            migrationAvailable: true,
            executionResponseList: expectedExecutionResponseList
          },
          addMigrationRunResponseForLint: true,

          ...(addLint === false
            ? {}
            : addLint === true
              ? {
                  lintResponseList: {
                    lintResponseList: [
                      {
                        fileLintResults: [],
                        migrationDir: 'mg1',
                        allSkipped: false,
                        firstError:
                          '"[{\\"Name\\":\\"00000000000000_baseline.sql\\",\\"Text\\":\\"CREATE EXTENSION IF NOT EXISTS \\\\\\"uuid-ossp\\\\\\";\\"},{\\"Name\\":\\"20231222064834_step1.sql\\",\\"Text\\":\\"CREATE TABLE\\\\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\\\\n\\"},{\\"Name\\":\\"20231222064941_step3.sql\\",\\"Text\\":\\"--atlas:txmode none\\\\n\\\\ncreate index concurrently idx_users_email on users(email);\\\\n\\\\ncreate index concurrently idx_users_age on users(age);\\"},{\\"Name\\":\\"20231222120857_step4.sql\\",\\"Text\\":\\"-- atlas:txmode none\\\\n\\\\nCREATE TABLE\\\\n  sessions (\\\\n    id int primary key,\\\\n    user_id int not null,\\\\n    data text not null,\\\\n    created_at timestamptz not null default now ()\\\\n  );\\\\n\\\\n-- works because table is created in this version\\\\ncreate index idx_sessions_user_id on sessions(user_id);\\\\n\\\\n\\"}]"'
                      }
                    ],
                    canSkipAllErrors: false
                  }
                }
              : { lintResponseList: addLint })
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
        mockM('runLintFromList', {
          lintResponseList: [
            AtlasLintResponse.build(
              JSON.stringify(c.artifacts.no_lint_error.lintResponseOutput.mg1),
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          canSkipAllErrors: false
        })

        notifier.notify = jest.fn().mockResolvedValue({
          githubComment: {},
          jiraComment: {},
          jiraIssue: getJiraIssue()
        } as NotifyResponse)
        ghClient.addLabel = jest.fn()

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
          getPR(),
          true
        )

        // Label added to PR
        expect(ghClient.addLabel).toHaveBeenCalledTimes(1)
        expect(ghClient.addLabel).toHaveBeenCalledWith(1, ['jira-ticket-created'])
      })

      // eslint-disable-next-line jest/expect-expect
      it('should ensure jira ticket when commented', async () => {
        mockM('runMigrationFromList', {
          migrationAvailable: true,
          executionResponseList: [
            AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
          ]
        })
        mockM('runLintFromList', {
          lintResponseList: [
            AtlasLintResponse.build(
              JSON.stringify(c.artifacts.no_lint_error.lintResponseOutput.mg1),
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          canSkipAllErrors: false
        })
        notifier.notify = jest.fn().mockResolvedValue({
          githubComment: {},
          jiraComment: {},
          jiraIssue: getJiraIssue()
        } as NotifyResponse)
        ghClient.addLabel = jest.fn()

        const svc = getSvc()

        const response = await svc.processEvent(
          c.getPRCommentContext({
            action: 'created',
            comment: c.getComment(212121, 'jira', 'user-ddd'),
            issue: getPR(['jira-ticket-created']),
            organization: {
              login: 'my-org'
            },
            repository: c.getRepo(),
            sender: c.user('user-aaa')
          })
        )

        validateResponse(
          response,
          {
            eventName: 'issue_comment',
            actionName: 'created',
            source: 'comment',
            triggeredBy: {
              login: 'user-aaa',
              type: 'User'
            },
            commentId: 212121,
            commentBody: 'db migrate jira',
            lintRequired: true,
            ensureJiraTicket: true
          },
          getPR(['jira-ticket-created']),
          true
        )

        // Label added to PR
        expect(ghClient.addLabel).toHaveBeenCalledTimes(1)
        expect(ghClient.addLabel).toHaveBeenCalledWith(1, ['db-migration'])
      })

      it('should not execute migration when pr is not approved in github from a user of approvalTeams', async () => {
        // pr not approved by anyone
        ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ccc'])
        vaultClient.getSecrets = jest.fn().mockResolvedValue({
          CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
        })
        notifier.notify = jest.fn()

        // JIRA ticket is approved
        jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
        const svc = getSvc()
        const response = await svc.processEvent(
          c.getPRCommentContext({
            action: 'created',
            comment: c.getComment(212121, '', 'user-ddd'),
            issue: getPR(['jira-ticket-created', 'db-migration']),
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
        expect(factory.getNotifier).toHaveBeenCalledWith(false, config, ghClient, jiraClient)
        expect(notifier.notify).toHaveBeenCalledTimes(1)
        expect(notifier.notify).toHaveBeenCalledWith({
          pr: getPR(['jira-ticket-created', 'db-migration']),
          migrationMeta: {
            eventName: 'issue_comment',
            actionName: 'created',
            source: 'comment',
            triggeredBy: c.user('user-aaa'),
            commentId: 212121,
            commentBody: 'db migrate',
            lintRequired: true
          },
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
        ghClient.addLabel = jest.fn()

        const response = await svc.processEvent(
          c.getPRReviewContext({
            action: 'submitted',
            organization: {
              login: 'my-org'
            },
            pull_request: getPR(['jira-ticket-created', 'db-migration']),
            repository: c.getRepo(),
            review: c.getReview('user-aaa', 1111111),
            sender: {
              login: 'user-bbb',
              type: 'User'
            }
          })
        )

        validateResponse(
          response,
          {
            eventName: 'pull_request_review',
            actionName: 'submitted',
            skipCommentWhenNoMigrationsAvailable: true,
            source: 'review',
            triggeredBy: {
              login: 'user-bbb',
              type: 'User'
            }
          },
          getPR(['jira-ticket-created', 'db-migration']),
          false,
          getJiraIssue()
        )

        expect(ghClient.addLabel).toHaveBeenCalledTimes(0)
      })

      it('should execute the migration', async () => {
        // pr not approved by approvalTeams
        ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ddd'])
        vaultClient.getSecrets = jest.fn().mockResolvedValue({
          CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
        })
        // JIRA ticket is approved
        jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
        mockM('runMigrationFromList', {
          migrationAvailable: true,
          executionResponseList: [
            AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
          ]
        })
        mockM('runLintFromList', {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.no_lint_error.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          canSkipAllErrors: false
        })
        notifier.notify = jest.fn()

        const svc = getSvc()
        const response = await svc.processEvent(
          c.getPRCommentContext({
            action: 'created',
            comment: c.getComment(212121, '', 'user-ddd'),
            issue: getPR(['jira-ticket-created', 'db-migration']),
            organization: {
              login: 'my-org'
            },
            repository: c.getRepo(),
            sender: c.user('user-aaa')
          })
        )

        const expectedExecutionResponseList = [
          {
            containsMigrations: true,
            migrations: buildMVER(c.artifacts.no_lint_error.versionExecution?.mg1)
          }
        ]

        const expectedResponse = {
          lintResponseList: {
            lintResponseList: [
              {
                fileLintResults: [],
                migrationDir: 'mg1',
                allSkipped: true
              }
            ],
            canSkipAllErrors: false
          },
          executionResponseList: expectedExecutionResponseList,
          migrationAvailable: true,
          ignore: false
        }

        expect(response).toEqual(expectedResponse)
        // Notified thus creating Github comment and JIRA issue
        expect(factory.getNotifier).toHaveBeenCalledTimes(1)
        expect(factory.getNotifier).toHaveBeenCalledWith(false, config, ghClient, jiraClient)
        expect(notifier.notify).toHaveBeenCalledTimes(1)
        expect(notifier.notify).toHaveBeenCalledWith({
          pr: getPR(['jira-ticket-created', 'db-migration']),
          migrationMeta: {
            eventName: 'issue_comment',
            actionName: 'created',
            source: 'comment',
            triggeredBy: { login: 'user-aaa', type: 'User' },
            commentId: 212121,
            commentBody: 'db migrate',
            lintRequired: true
          },
          migrationRunListResponse: {
            migrationAvailable: true,
            executionResponseList: expectedExecutionResponseList
          }
        })
      })

      it('should error out while execute the migration on linting errors', async () => {
        // pr not approved by approvalTeams
        ghClient.getPullRequestApprovedUserList = jest.fn().mockResolvedValue(['user-ddd'])
        vaultClient.getSecrets = jest.fn().mockResolvedValue({
          CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
        })
        // JIRA ticket is approved
        jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
        mockM('runLintFromList', {
          lintResponseList: [
            AtlasLintResponse.build(
              JSON.stringify(c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1),
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'some error encountered',
          canSkipAllErrors: false
        })
        notifier.notify = jest.fn()

        const svc = getSvc()
        const response = await svc.processEvent(
          c.getPRCommentContext({
            action: 'created',
            comment: c.getComment(212121, '', 'user-ddd'),
            issue: getPR(['jira-ticket-created', 'db-migration']),
            organization: {
              login: 'my-org'
            },
            repository: c.getRepo(),
            sender: c.user('user-aaa')
          })
        )

        const expectedLintResponse = {
          lintResponseList: [
            {
              fileLintResults: [],
              migrationDir: 'mg1',
              allSkipped: false,
              firstError:
                '"[{\\"Name\\":\\"20231222064941_step3.sql\\",\\"Error\\":\\"executing statement: pq: column \\\\\\"email\\\\\\" does not exist\\"}]"'
            }
          ],
          errMsg: 'some error encountered',
          canSkipAllErrors: false
        }

        expect(response).toEqual({
          lintResponseList: expectedLintResponse,
          executionResponseList: [],
          migrationAvailable: false,
          ignore: true
        })

        // Notified thus creating Github comment and JIRA issue
        expect(factory.getNotifier).toHaveBeenCalledTimes(1)
        expect(factory.getNotifier).toHaveBeenCalledWith(false, config, ghClient, jiraClient)
        expect(notifier.notify).toHaveBeenCalledTimes(1)
        expect(notifier.notify).toHaveBeenCalledWith({
          pr: getPR(['jira-ticket-created', 'db-migration']),
          migrationMeta: {
            eventName: 'issue_comment',
            actionName: 'created',
            source: 'comment',
            triggeredBy: { login: 'user-aaa', type: 'User' },
            commentId: 212121,
            commentBody: 'db migrate',
            lintRequired: true
          },
          migrationRunListResponse: {
            migrationAvailable: false,
            executionResponseList: []
          },
          jiraIssue: getApprovedJiraIssue(),
          lintResponseList: {
            lintResponseList: [
              {
                fileLintResults: [],
                migrationDir: 'mg1',
                allSkipped: false,
                firstError:
                  '"[{\\"Name\\":\\"20231222064941_step3.sql\\",\\"Error\\":\\"executing statement: pq: column \\\\\\"email\\\\\\" does not exist\\"}]"'
              }
            ],
            errMsg: 'some error encountered',
            canSkipAllErrors: false
          }
        })
        expect(migration.runMigrationFromList).toHaveBeenCalledTimes(0)
        expect(coreSetFailed).toHaveBeenCalledWith('some error encountered')
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
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
      })
      // JIRA ticket is approved
      jiraClient.findIssue = jest.fn().mockResolvedValue(getApprovedJiraIssue())
      mockM('runMigrationFromList', {
        migrationAvailable: true,
        executionResponseList: [AtlasMigrationExecutionResponse.fromError(expectedErrMsg)],
        errMsg: expectedErrMsg
      })
      mockM('runLintFromList', { lintResponseList: [], canSkipAllErrors: false })
      notifier.notify = jest.fn()

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

      const expectedExecutionResponseList = [
        {
          containsMigrations: false,
          migrations: [],
          firstError: expectedErrMsg
        }
      ]

      const expectedResponse = {
        lintResponseList: { lintResponseList: [], canSkipAllErrors: false },
        executionResponseList: [{ containsMigrations: false, migrations: [], firstError: expectedErrMsg }],
        migrationAvailable: true,
        ignore: true
      }

      expect(response).toEqual(expectedResponse)
      // Notified thus creating Github comment and JIRA issue
      expect(factory.getNotifier).toHaveBeenCalledTimes(1)
      expect(factory.getNotifier).toHaveBeenCalledWith(false, config, ghClient, jiraClient)
      expect(notifier.notify).toHaveBeenCalledTimes(1)
      expect(notifier.notify).toHaveBeenCalledWith({
        pr: getPR(),
        migrationMeta: {
          eventName: 'issue_comment',
          actionName: 'created',
          source: 'comment',
          triggeredBy: { login: 'user-aaa', type: 'User' },
          commentId: 212121,
          commentBody: 'db migrate',
          lintRequired: true
        },
        migrationRunListResponse: {
          migrationAvailable: true,
          executionResponseList: expectedExecutionResponseList,
          errMsg: expectedErrMsg
        }
      })

      expect(coreSetFailed).toHaveBeenCalledWith(expectedErrMsg)
    })

    // You add SQL files in PR. The label will be added to the PR
    // after that when PR is removed, then the gha register the error(core.error method)

    it('should return silently when sql files are removed from PR', async () => {
      ghClient.getChangedFiles = jest.fn().mockResolvedValue([])

      const svc = getSvc()
      const response = await svc.processEvent(
        c.getPRContext({
          action: 'synchronize',
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

      expect(response).toEqual({
        executionResponseList: [],
        migrationAvailable: false,
        ignore: true
      })
      expect(coreSetFailed).toHaveBeenCalledTimes(0)
    })

    it('should close pr if migration has unwanted files', async () => {
      const svc = getSvc()

      mockM('runMigrationFromList', {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.build(JSON.stringify(c.artifacts.no_lint_error.versionExecution?.mg1))
        ]
      })
      mockM('buildMigrationConfigList', c.getMigrationConfigList())
      mockM('runLintFromList', {
        lintResponseList: [
          AtlasLintResponse.build(
            JSON.stringify(c.artifacts.no_lint_error.lintResponseOutput.mg1),
            'mg1',
            [],
            LINT_CODE_DEFAULT_PREFIXES
          )
        ],
        canSkipAllErrors: false
      })
      ghClient.getChangedFiles = jest
        .fn()
        .mockResolvedValue([...Object.keys(c.getMockDirectories().migrations).map(f => `migrations/${f}`), 'file/a.go'])

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

      expect(response).toEqual({
        executionResponseList: [],
        migrationAvailable: true,
        ignore: true
      })

      expect(notifier.notify).toHaveBeenCalledTimes(1)
      expect(notifier.notify).toHaveBeenCalledWith({
        pr: getPR(),
        migrationMeta: {
          actionName: 'opened',
          ensureJiraTicket: true,
          eventName: 'pull_request',
          lintRequired: true,
          source: 'pr',
          triggeredBy: {
            login: 'user-aaa',
            type: 'User'
          }
        },
        migrationRunListResponse: {
          migrationAvailable: false,
          executionResponseList: []
        },
        changedFileValidation: {
          errMsg: 'Unwanted files found',
          migrationAvailable: true,
          unmatched: ['file/a.go']
        },
        closePR: true
      })

      expect(coreSetFailed).toHaveBeenCalledWith('Unwanted files found')
    })
  })

  describe('processDrift', () => {
    let scheduleContext: ContextSchedule
    beforeEach(() => {
      scheduleContext = c.getScheduleContext(c.getSchedulePayload())
    })
    // !driftRunListResponse.errMsg && driftRunListResponse.hasSchemaDrifts === false
    it('should have no schema drifts', async () => {
      const svc = getSvc()
      const driftRunListResponse = { hasSchemaDrifts: false, drifts: [] }
      vaultClient.getSecrets = jest.fn().mockResolvedValue({
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
      })
      mockM('runSchemaDriftFromList', driftRunListResponse)

      const response = await svc.processDrift(scheduleContext)

      expect(response).toEqual({ driftRunListResponse })
    })
    it('should skip for invalid event name', async () => {
      const svc = getSvc()
      const driftRunListResponse = { hasSchemaDrifts: false, drifts: [] }
      vaultClient.getSecrets = jest.fn().mockResolvedValue({
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
      })
      mockM('runSchemaDriftFromList', driftRunListResponse)
      svc.skipProcessingHandler = jest.fn()

      const payload = c.getSchedulePayload()
      const contextSchedule = c.getScheduleContext(payload) as any
      contextSchedule.eventName = 'invalid_event'

      const response = await svc.processDrift(contextSchedule)

      expect(response).toEqual(undefined)
      expect(svc.skipProcessingHandler).toHaveBeenCalledWith('invalid_event', { action: payload.schedule })
    })

    // notifier.drift
    it('should have drifts', async () => {
      const svc = getSvc()
      const driftRunListResponse = { hasSchemaDrifts: true, drifts: [AtlasDriftResponse.build('some error')] }
      const jiraIssue = getApprovedJiraIssue(false, true)

      vaultClient.getSecrets = jest.fn().mockResolvedValue({
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
      })
      jiraClient.findSchemaDriftIssue = jest.fn().mockResolvedValue(jiraIssue)
      notifier.drift = jest.fn().mockResolvedValue({ jiraIssue, jiraComment: undefined })
      mockM('runSchemaDriftFromList', driftRunListResponse)

      const response = await svc.processDrift(scheduleContext)

      expect(response).toEqual({ driftRunListResponse, jiraIssue, jiraComment: undefined })
      expect(jiraClient.findSchemaDriftIssue).toHaveBeenCalledTimes(1)
      expect(jiraClient.findSchemaDriftIssue).toHaveBeenCalledWith(
        scheduleContext.payload.repository.html_url,
        config.jira?.doneValue
      )
      expect(notifier.drift).toHaveBeenCalledWith({
        driftRunListResponse,
        jiraIssue,
        repo: scheduleContext.payload.repository
      })
    })

    it('should have drifts without jira integration', async () => {
      const driftRunListResponse = { hasSchemaDrifts: true, drifts: [AtlasDriftResponse.build('some error')] }
      const jiraIssue = undefined

      vaultClient.getSecrets = jest.fn().mockResolvedValue({
        CALCULATOR_SVC_DB: 'postgres://some-host:1/calculator-svc?search_path=public'
      })
      notifier.drift = jest.fn().mockResolvedValue({ jiraIssue, jiraComment: undefined })
      mockM('runSchemaDriftFromList', driftRunListResponse)

      const svc = getSvc({ jiraConfig: null })
      const response = await svc.processDrift(scheduleContext)

      expect(response).toEqual({ driftRunListResponse, jiraIssue, jiraComment: undefined })
      expect(notifier.drift).toHaveBeenCalledWith({
        driftRunListResponse,
        jiraIssue,
        repo: scheduleContext.payload.repository
      })
    })
  })
})
