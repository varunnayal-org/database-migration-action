import { Config, JiraIssue } from '../src/types.jira'
import { MatchTeamWithPRApproverResult, MigrationConfig, MigrationMeta } from '../src/types'
import * as gha from '../src/types.gha'
import {
  validateChangedFiles,
  validateMigrationExecutionForApproval,
  validateMigrationExecutionForJiraApproval,
  validateOwnerTeam,
  validatePullRequest
} from '../src/validators'

describe('validatePullRequest', () => {
  it('should return undefined if pull request is valid', () => {
    const pullRequest = {
      base: {
        ref: 'master'
      },
      state: 'open',
      draft: false
    } as gha.PullRequest
    const baseBranch = 'master'

    const result = validatePullRequest(pullRequest, baseBranch)

    expect(result).toBeUndefined()
  })

  it('should return error if base branch does not match', () => {
    const pullRequest = {
      base: {
        ref: 'develop'
      },
      state: 'open',
      draft: false
    } as gha.PullRequest
    const baseBranch = 'master'

    const result = validatePullRequest(pullRequest, baseBranch)

    expect(result).toEqual('Base branch should be master, found develop')
  })

  it('should return error message if pull request is in draft state', () => {
    const pullRequest = {
      base: {
        ref: 'master'
      },
      state: 'open',
      draft: true
    } as gha.PullRequest
    const baseBranch = 'master'

    const result = validatePullRequest(pullRequest, baseBranch)

    expect(result).toEqual('PR is in draft state')
  })

  it('should return error message if pull request is not in open state', () => {
    const pullRequest = {
      base: {
        ref: 'master'
      },
      state: 'closed',
      draft: false
    } as gha.PullRequest
    const baseBranch = 'master'

    const result = validatePullRequest(pullRequest, baseBranch)

    expect(result).toEqual('PR is in closed state')
  })
})

describe('validateOwnerTeam', () => {
  it('should return true if user is part of owner team', () => {
    const migrationMeta = {
      triggeredBy: {
        login: 'user1'
      }
    } as MigrationMeta
    const ownerTeams = ['team1']
    const teamByName = {
      team1: ['user1']
    }

    const result = validateOwnerTeam(migrationMeta, ownerTeams, teamByName)

    expect(result).toEqual(true)
  })

  it('should return false if user is not part of owner team', () => {
    const migrationMeta = {
      triggeredBy: {
        login: 'user1'
      }
    } as MigrationMeta
    const ownerTeams = ['team1']
    const teamByName = {
      team1: ['user2']
    }

    const result = validateOwnerTeam(migrationMeta, ownerTeams, teamByName)

    expect(result).toEqual(false)
  })

  it('should return false if user is not part of any team', () => {
    const migrationMeta = {
      triggeredBy: {
        login: 'user1'
      }
    } as MigrationMeta
    const ownerTeams = ['team1']
    const teamByName = {}

    const result = validateOwnerTeam(migrationMeta, ownerTeams, teamByName)

    expect(result).toEqual(false)
  })
})

describe('validateMigrationExecutionForApproval', () => {
  it('should return undefined if all approvals are in place', () => {
    const pullRequest = {
      base: {
        ref: 'master',
        repo: {
          owner: {
            login: 'org1'
          },
          name: 'repo1'
        }
      },
      state: 'open',
      draft: false
    } as gha.PullRequest
    const migrationMeta = {
      triggeredBy: {
        login: 'user1'
      }
    } as MigrationMeta
    const ownerTeams = ['team1']
    const teams: MatchTeamWithPRApproverResult = {
      teamByName: { team1: ['user1'] },
      prApprovedUserListByTeam: {},
      approvalMissingFromTeam: []
    }

    const result = validateMigrationExecutionForApproval(pullRequest, migrationMeta, ownerTeams, teams)

    expect(result).toBeUndefined()
  })

  it('should return error if approvals are not in place', () => {
    const pullRequest = {
      base: {
        ref: 'master',
        repo: {
          owner: {
            login: 'org1'
          },
          name: 'repo1'
        }
      },
      state: 'open',
      draft: false
    } as gha.PullRequest
    const migrationMeta = {
      triggeredBy: {
        login: 'user1'
      }
    } as MigrationMeta
    const ownerTeams = ['team1']
    const teams: MatchTeamWithPRApproverResult = {
      teamByName: { team1: ['user1'] },
      prApprovedUserListByTeam: {},
      approvalMissingFromTeam: ['team2', 'team3']
    }

    const result = validateMigrationExecutionForApproval(pullRequest, migrationMeta, ownerTeams, teams)

    expect(result).toEqual('PR is not approved by @org1/team2, @org1/team3')
  })

  it('should return error if user is not part of owner team', () => {
    const pullRequest = {
      base: {
        ref: 'master',
        repo: {
          owner: {
            login: 'org1'
          },
          name: 'repo1'
        }
      },
      state: 'open',
      draft: false
    } as gha.PullRequest
    const migrationMeta = {
      triggeredBy: {
        login: 'user1'
      }
    } as MigrationMeta
    const ownerTeams = ['team1', 'team2']
    const teams: MatchTeamWithPRApproverResult = {
      teamByName: { team1: ['user2', 'user3'], team2: ['user2', 'user4'] },
      prApprovedUserListByTeam: {},
      approvalMissingFromTeam: []
    }

    const result = validateMigrationExecutionForApproval(pullRequest, migrationMeta, ownerTeams, teams)

    expect(result).toBe('User is not part of any owner team')
  })
})

describe('validateMigrationExecutionForJiraApproval', () => {
  it('should return undefined if jira config is not present', () => {
    const jiraConfig = undefined
    const jiraIssue = undefined

    const result = validateMigrationExecutionForJiraApproval(jiraConfig, jiraIssue)

    expect(result).toBeUndefined()
  })
  it('should return undefined is passed all validation checks when jira config is defined', () => {
    const jiraConfig = {
      doneValue: 'Done',
      fields: {
        driApprovals: ['customfield_11111', 'customfield_22222']
      },
      approvalStatus: 'DONE'
    } as unknown as Config
    const jiraIssue = {
      key: 'KEY-1',
      fields: {
        customfield_11111: { value: 'DONE' },
        customfield_22222: { value: 'DONE' },
        resolution: {
          name: 'Done'
        }
      }
    } as unknown as JiraIssue

    const result = validateMigrationExecutionForJiraApproval(jiraConfig, jiraIssue)

    expect(result).toBeUndefined()
  })

  it('should return error if jira ticket is not created', () => {
    const jiraConfig = {} as unknown as Config
    const jiraIssue = null

    const result = validateMigrationExecutionForJiraApproval(jiraConfig, jiraIssue)

    expect(result).toEqual(`JIRA Issue not found. Please add comment *db migrate dry-run* to create JIRA ticket`)
  })

  it('should return error if jira ticket is not resolved', () => {
    const jiraConfig = {
      doneValue: 'Done'
    } as unknown as Config
    const jiraIssue = {
      key: 'KEY-1',
      fields: {
        resolution: null
      }
    } as unknown as JiraIssue

    const result = validateMigrationExecutionForJiraApproval(jiraConfig, jiraIssue)

    expect(result).toEqual(`JIRA Issue KEY-1 is not resolved yet (state=NA)`)
  })

  it('should return error if all dri approvals are missing', () => {
    const jiraConfig = {
      doneValue: 'Done',
      fields: {
        driApprovals: ['customfield_11111', 'customfield_22222']
      },
      approvalStatus: 'DONE'
    } as unknown as Config
    const jiraIssue = {
      key: 'KEY-1',
      fields: {
        customfield_11111: { value: 'Pending' },
        // customfield_22222: '',
        resolution: {
          name: 'Done'
        }
      }
    } as unknown as JiraIssue

    const result = validateMigrationExecutionForJiraApproval(jiraConfig, jiraIssue)

    expect(result).toEqual('JIRA Issue is not approved by DRIs customfield_11111, customfield_22222')
  })

  it('should return error if any of the dri approvals are missing', () => {
    const jiraConfig = {
      doneValue: 'Done',
      fields: {
        driApprovals: ['customfield_11111', 'customfield_22222']
      },
      approvalStatus: 'DONE'
    } as unknown as Config
    const jiraIssue = {
      key: 'KEY-1',
      fields: {
        customfield_11111: { value: 'DONE' },
        resolution: {
          name: 'Done'
        }
      }
    } as unknown as JiraIssue

    const result = validateMigrationExecutionForJiraApproval(jiraConfig, jiraIssue)

    expect(result).toEqual('JIRA Issue is not approved by DRIs customfield_22222')
  })
})

describe('validateChangedFiles', () => {
  const dbMigrationFile = './db.migration.json'
  it('should return undefined if only migration files are found', () => {
    const migrationConfigList: MigrationConfig[] = [
      {
        originalDir: 'migrations/db1',
        lintLatestFiles: 0
      } as unknown as MigrationConfig,
      {
        originalDir: 'migrations/db2',
        lintLatestFiles: 0
      } as unknown as MigrationConfig
    ]
    const changedFiles = [
      'migrations/db1/1.sql',
      'migrations/db1/2.sql',
      'migrations/db2/1.sql',
      'migrations/db2/2.sql',
      'migrations/db2/3.sql',
      'migrations/db2/4.sql'
    ]
    const response = validateChangedFiles(migrationConfigList, changedFiles, dbMigrationFile)

    expect(migrationConfigList[0].lintLatestFiles).toBe(2)
    expect(migrationConfigList[1].lintLatestFiles).toBe(4)
    expect(response).toBeUndefined()
  })

  it('should return undefined if migration files are found with allowed files', () => {
    const migrationConfigList: MigrationConfig[] = [
      {
        originalDir: 'migrations/db1',
        lintLatestFiles: 0
      } as unknown as MigrationConfig,
      {
        originalDir: 'migrations/db2',
        lintLatestFiles: 0
      } as unknown as MigrationConfig
    ]
    const changedFiles = [
      'migrations/db1/1.sql',
      'Makefile',
      'migrations/a.yaml',
      'migrations/db1/2.sql',
      'migrations/db2/1.sql',
      'atlas.hcl',
      'migrations/atlas.sum',
      'file.json',
      'migrations/InitDbChanges.xml',
      'src/config.yaml'
    ]
    const response = validateChangedFiles(migrationConfigList, changedFiles, dbMigrationFile)

    expect(migrationConfigList[0].lintLatestFiles).toBe(2)
    expect(migrationConfigList[1].lintLatestFiles).toBe(1)
    expect(response).toBeUndefined()
  })

  it('should return undefined if migration files are found for one of the directory', () => {
    const migrationConfigList: MigrationConfig[] = [
      {
        originalDir: 'migrations/db1',
        lintLatestFiles: 0
      } as unknown as MigrationConfig,
      {
        originalDir: 'migrations/db2',
        lintLatestFiles: 0
      } as unknown as MigrationConfig
    ]
    // no migration for db2
    const changedFiles = [
      'Makefile',
      'migrations/db2/1.sql',
      'migrations/a.yaml',
      'migrations/db2/2.sql',
      'src/config.yaml'
    ]
    const response = validateChangedFiles(migrationConfigList, changedFiles, dbMigrationFile)

    expect(migrationConfigList[0].lintLatestFiles).toBe(0)
    expect(migrationConfigList[1].lintLatestFiles).toBe(2)
    expect(response).toBeUndefined()
  })

  it('should return error if no files are changed', () => {
    const response = validateChangedFiles([], [], dbMigrationFile)

    expect(response).toEqual({ errMsg: 'No files changed', unmatched: [], migrationAvailable: false })
  })

  it('should return error if no migration files are found', () => {
    const migrationConfigList: MigrationConfig[] = [
      {
        originalDir: 'migrations/db1',
        lintLatestFiles: 0
      } as unknown as MigrationConfig,
      {
        originalDir: 'migrations/db2',
        lintLatestFiles: 0
      } as unknown as MigrationConfig
    ]
    const changedFiles = ['Makefile', 'migrations/a.txt', 'src/config.json', 'migrations/1.sql']

    const response = validateChangedFiles(migrationConfigList, changedFiles, dbMigrationFile)

    expect(migrationConfigList[0].lintLatestFiles).toBe(0)
    expect(migrationConfigList[1].lintLatestFiles).toBe(0)
    expect(response).toEqual({ errMsg: 'No migrations available', unmatched: [], migrationAvailable: false })
  })

  it('should return error if unwanted files are present', () => {
    const migrationConfigList: MigrationConfig[] = [
      {
        originalDir: 'migrations/db1',
        lintLatestFiles: 0
      } as unknown as MigrationConfig,
      {
        originalDir: 'migrations/db2',
        lintLatestFiles: 0
      } as unknown as MigrationConfig
    ]
    const changedFiles = [
      'migrations/db1/1.sql',
      'Makefile',
      'migrations/a.txt',
      'migrations/db1/2.sql',
      'migrations/db2/1.sql',
      'migrations/db2/2.sql',
      'src/config.json',
      'migrations/db2/3.sql',
      'migrations/db2/4.sql'
    ]
    const response = validateChangedFiles(migrationConfigList, changedFiles, dbMigrationFile)

    expect(migrationConfigList[0].lintLatestFiles).toBe(2)
    expect(migrationConfigList[1].lintLatestFiles).toBe(4)
    expect(response).toEqual({
      errMsg: 'Unwanted files found',
      unmatched: ['migrations/a.txt'],
      migrationAvailable: true
    })
  })
})
