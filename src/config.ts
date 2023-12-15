import path from 'path'
import { getInput } from './util'
import { Config as JIRAConfig } from './client/jira'

/**
 * Represents the configuration options for the database migration action.
 */
export interface Config {
  /**
   * Name of the service.
   */
  serviceName: string

  /**
   * Directory where migrations are present.
   */
  baseDirectory: string

  /**
   * Base branch to which merging should occur.
   */
  baseBranch: string

  /**
   * Label to add on PR.
   */
  prLabel: string

  /**
   * GitHub teams allowed to approve PR.
   */
  approvalTeams: string[]

  /**
   * GitHub teams that own the repository.
   */
  ownerTeams: string[]

  /**
   * Combination of approvalTeams and ownerTeams.
   */
  allTeams: string[]

  /**
   * Configuration options for the databases.
   */
  databases: DatabaseConfig[]

  /**
   * List of secrets to fetch from AWS Secrets Manager. Generated from "databases.*.envName".
   */
  dbSecretNameList: string[]

  /**
   * Configuration options for JIRA integration.
   */
  jira?: JIRAConfig
}

export interface DatabaseConfig {
  directory: string
  schema: string
  baseline?: string
  envName: string
}

export default function buildConfig(): Config {
  const configFileName = getInput('migration_config_file', './db.migration.json')
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, import/no-dynamic-require
  const config: Config = require(path.join(process.env.LOCAL_TESTING_REPO_DIR || process.cwd(), configFileName))

  if (!config.serviceName) {
    throw new Error('Config serviceName is not set')
  }
  if (!Array.isArray(config.databases) || config.databases.length === 0) {
    console.log(config)
    throw new Error('No databases configured')
  }

  if (!Array.isArray(config.ownerTeams) || config.ownerTeams.length === 0) {
    console.log(config)
    throw new Error(`No owner team configured. Add ownerTeams in ${configFileName}`)
  }
  config.ownerTeams = [...new Set(config.ownerTeams)]
  config.approvalTeams = [...new Set(config.approvalTeams)]

  config.allTeams = [...new Set([...config.ownerTeams, ...config.approvalTeams])]

  if (!config.baseDirectory) {
    config.baseDirectory = './migrations'
  }
  if (!config.baseBranch) {
    config.baseBranch = 'main'
  }
  config.prLabel = 'db-migration'

  config.dbSecretNameList = config.databases.reduce<string[]>((acc, dbConfig, idx) => {
    if (!dbConfig.envName) {
      throw new Error(`Config databases.${idx}.envName is not set`)
    }
    if (acc.includes(dbConfig.envName)) {
      throw new Error(`Config databases.${idx}.envName is duplicate`)
    }
    acc.push(dbConfig.envName)

    if (!dbConfig.directory) {
      dbConfig.directory = '.'
    }
    dbConfig.schema = dbConfig.schema || 'public'
    return acc
  }, [])
  console.log(`Loaded Config from ${configFileName} `, config)

  config.jira = getJiraConfig(config.serviceName)

  return config
}

const getJiraConfig = (jiraLabel: string): JIRAConfig | undefined => {
  const jiraConfigString = getInput('jira_config', '')
  if (!jiraConfigString) {
    return undefined
  }

  const jiraConfig = JSON.parse(jiraConfigString) as JIRAConfig
  jiraConfig.fields = jiraConfig.fields || {}
  jiraConfig.issueType = jiraConfig.issueType || 'Task'
  jiraConfig.label = jiraLabel
  jiraConfig.doneValue = jiraConfig.doneValue || 'Done'

  if ('driApprovals' in jiraConfig.fields) {
    if (!jiraConfig.fields.driApprovals) {
      jiraConfig.fields.driApprovals = []
    } else if (typeof jiraConfig.fields.driApprovals === 'string') {
      jiraConfig.fields.driApprovals = (jiraConfig.fields.driApprovals as string).split(',')
      jiraConfig.approvalStatus = jiraConfig.approvalStatus || 'DONE'
    }
  }

  return jiraConfig
}
