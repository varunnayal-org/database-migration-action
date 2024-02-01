import path from 'path'
import * as core from '@actions/core'
import { getInput } from './util'
import { Config as JIRAConfig } from './types.jira'
import {
  DEFAULT_BASE_BRANCH,
  DEFAULT_JIRA_COMPLETED_STATUS,
  DEFAULT_JIRA_DRI_APPROVAL_STATUS,
  DEFAULT_JIRA_ISSUE_TYPE,
  DEFAULT_JIRA_SCHEMA_DRIFT_ISSUE_TYPE,
  DEFAULT_JIRA_SCHEMA_DRIFT_LABEL,
  DEFAULT_MIGRATION_BASE_DIR,
  DEFAULT_MIGRATION_CHILD_DIR,
  DEFAULT_PR_LABEL,
  DEFAULT_REVISION_SCHEMA,
  LINT_CODE_DEFAULT_PREFIXES,
  LINT_SKIP_ERROR_LABEL_PREFIX
} from './constants'
import { Config } from './types'

function prepareRuntimeConfig(config: Config, configFileName: string): void {
  config.configFileName = configFileName
  config.devDBUrl = core.getInput('dev_db_url')
  config.lintCodePrefixes = LINT_CODE_DEFAULT_PREFIXES
  config.lintSkipErrorLabelPrefix = config.lintSkipErrorLabelPrefix || LINT_SKIP_ERROR_LABEL_PREFIX
  config.allTeams = [...new Set([...config.ownerTeams, ...config.approvalTeams])]

  config.dbSecretNameList = config.databases.reduce<string[]>((acc, dbConfig, idx) => {
    if (!dbConfig.envName) {
      throw new Error(`Config databases.${idx}.envName is not set`)
    }
    if (acc.includes(dbConfig.envName)) {
      throw new Error(`Config databases.${idx}.envName is duplicate`)
    }
    if (!dbConfig.revisionSchema) {
      dbConfig.revisionSchema = DEFAULT_REVISION_SCHEMA
    }
    acc.push(dbConfig.envName)

    if (!dbConfig.directory) {
      dbConfig.directory = DEFAULT_MIGRATION_CHILD_DIR
    }
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

  if (!config.baseDirectory) {
    config.baseDirectory = DEFAULT_MIGRATION_BASE_DIR
  }
  if (!config.baseBranch) {
    config.baseBranch = DEFAULT_BASE_BRANCH
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
  if (!jiraConfig.host) {
    throw new Error('Jira config missing host')
  }
  if (!jiraConfig.project) {
    throw new Error('Jira config missing project')
  }

  jiraConfig.fields = jiraConfig.fields || {}
  if (!jiraConfig.fields.pr) {
    throw new Error('Jira config missing pr field')
  }
  if (!jiraConfig.fields.repo) {
    throw new Error('Jira config missing repo field')
  }
  if (!jiraConfig.fields.repoLabel) {
    throw new Error('Jira config missing repo label field')
  }

  jiraConfig.issueType = jiraConfig.issueType || DEFAULT_JIRA_ISSUE_TYPE
  jiraConfig.label = jiraLabel
  jiraConfig.schemaDriftIssueType = jiraConfig.schemaDriftIssueType || DEFAULT_JIRA_SCHEMA_DRIFT_ISSUE_TYPE
  jiraConfig.schemaDriftLabel = jiraConfig.schemaDriftLabel || DEFAULT_JIRA_SCHEMA_DRIFT_LABEL
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
