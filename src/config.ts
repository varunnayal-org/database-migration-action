import path from 'path'
import * as core from '@actions/core'
import { getInput } from './util'
import { Config as JIRAConfig } from './client/jira'
import {
  DEFAULT_JIRA_COMPLETED_STATUS,
  DEFAULT_JIRA_DRI_APPROVAL_STATUS,
  DEFAULT_JIRA_ISSUE_TYPE,
  DEFAULT_MIGRATION_BASE_DIR,
  DEFAULT_MIGRATION_CHILD_DIR,
  DEFAULT_PR_LABEL,
  DEFAULT_SCHEMA,
  LINT_CODE_DEFAULT_PREFIXES,
  LINT_SKIP_ERROR_LABEL_PREFIX
} from './constants'

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

  // These are filled by code

  /**
   * Base branch to which merging should occur.
   */
  baseBranch: string

  /**
   * Name of the config file.
   */
  configFileName: string

  /**
   * List of secrets to fetch from AWS Secrets Manager. Generated from "databases.*.envName".
   */
  dbSecretNameList: string[]

  /**
   * URL of the development database used for linting.
   */
  devDBUrl: string

  /**
   * Configuration options for JIRA integration.
   */
  jira?: JIRAConfig

  /**
   * An array of prefixes for lint error codes.
   *
   * This property is of type `string[]`. It is used to categorize lint errors based on their code prefix.
   * By convention, the lint error's code prefix can be used to determine the type or category of the error.
   */
  lintCodePrefixes: string[]

  /**
   * Represents the prefix for the label of lint errors that can be skipped.
   *
   * This property is of type `string`. It is used to identify lint errors that can be skipped
   * based on their label. By convention, any lint error whose label starts with this prefix
   * can be skipped.
   */
  lintSkipErrorLabelPrefix: string
}

export interface DatabaseConfig {
  directory: string
  schema: string
  baseline?: string
  envName: string
}

function prepareRuntimeConfig(config: Config, configFileName: string): void {
  config.configFileName = configFileName
  config.devDBUrl = core.getInput('dev_db_url')
  config.lintCodePrefixes = LINT_CODE_DEFAULT_PREFIXES
  config.lintSkipErrorLabelPrefix = config.lintSkipErrorLabelPrefix || LINT_SKIP_ERROR_LABEL_PREFIX

  config.dbSecretNameList = config.databases.reduce<string[]>((acc, dbConfig, idx) => {
    if (!dbConfig.envName) {
      throw new Error(`Config databases.${idx}.envName is not set`)
    }
    if (acc.includes(dbConfig.envName)) {
      throw new Error(`Config databases.${idx}.envName is duplicate`)
    }
    acc.push(dbConfig.envName)

    if (!dbConfig.directory) {
      dbConfig.directory = DEFAULT_MIGRATION_CHILD_DIR
    }
    dbConfig.schema = dbConfig.schema || DEFAULT_SCHEMA
    return acc
  }, [])

  config.jira = getJiraConfig(config.serviceName)
}

export default function buildConfig(): Config {
  const configFileName = getInput('migration_config_file', './db.migration.json')
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, import/no-dynamic-require
  const config: Config = require(path.join(process.env.LOCAL_TESTING_REPO_DIR || process.cwd(), configFileName))

  if (!config.serviceName) {
    throw new Error('Config serviceName is not set')
  }
  if (!Array.isArray(config.databases) || config.databases.length === 0) {
    throw new Error('No databases configured')
  }

  if (!Array.isArray(config.ownerTeams) || config.ownerTeams.length === 0) {
    throw new Error(`No owner team configured. Add ownerTeams in ${configFileName}`)
  }
  config.ownerTeams = [...new Set(config.ownerTeams)]
  config.approvalTeams = [...new Set(config.approvalTeams)]

  config.allTeams = [...new Set([...config.ownerTeams, ...config.approvalTeams])]

  if (!config.baseDirectory) {
    config.baseDirectory = DEFAULT_MIGRATION_BASE_DIR
  }
  if (!config.baseBranch) {
    config.baseBranch = 'main'
  }

  config.prLabel = config.prLabel || DEFAULT_PR_LABEL

  prepareRuntimeConfig(config, configFileName)

  core.debug(`Loaded Config from ${configFileName}: ${JSON.stringify(config)}`)

  return config
}

const getJiraConfig = (jiraLabel: string): JIRAConfig | undefined => {
  const jiraConfigString = getInput('jira_config', '')
  if (!jiraConfigString) {
    return undefined
  }

  const jiraConfig = JSON.parse(jiraConfigString) as JIRAConfig
  jiraConfig.fields = jiraConfig.fields || {}
  jiraConfig.issueType = jiraConfig.issueType || DEFAULT_JIRA_ISSUE_TYPE
  jiraConfig.label = jiraLabel
  jiraConfig.doneValue = jiraConfig.doneValue || DEFAULT_JIRA_COMPLETED_STATUS

  if ('driApprovals' in jiraConfig.fields) {
    if (!jiraConfig.fields.driApprovals) {
      jiraConfig.fields.driApprovals = []
    } else if (typeof jiraConfig.fields.driApprovals === 'string') {
      jiraConfig.fields.driApprovals = (jiraConfig.fields.driApprovals as string).split(',')
      jiraConfig.approvalStatus = jiraConfig.approvalStatus || DEFAULT_JIRA_DRI_APPROVAL_STATUS
    }
  }

  return jiraConfig
}
