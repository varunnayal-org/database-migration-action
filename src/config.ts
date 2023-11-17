import path from 'path'
import { getInput } from './util'

export interface Config {
  base_directory: string
  base_branch: string
  tokens: TokenConfig
  jira: {
    domain: string
    project: string
    issue_type: string
    ticket_label: string
    status_id_initial: string
    status_id_completed: string
    custom_field_pr_link: string
    custom_field_repo_link: string
  }
  pr_label: string
  teams: string[]
  databases: DatabaseConfig[]
  secret_provider: {
    path: string
  }
}

export interface TokenConfig {
  github: string
  jira_token: string
  jira_user: string
}

export interface DatabaseConfig {
  directory: string
  migration_table: string
  url_path: string
}

export default function buildConfig(): Config {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, import/no-dynamic-require
  const config: Config = require(path.join(process.cwd(), getInput('migration_config_file', './db.migration.json')))

  if (!config.base_directory) {
    config.base_directory = 'migrations'
  }
  if (!config.base_branch) {
    config.base_branch = 'main'
  }

  if (!config.tokens) {
    // tokens
    config.tokens = {} as TokenConfig
  }
  if (!config.tokens.github) {
    config.tokens.github = 'GH_TOKEN'
  }

  if (!config.base_directory) {
    config.base_directory = 'migrations'
  }

  if (!config.teams) {
    config.teams = []
  }

  if (config.pr_label) {
    config.pr_label = 'db-migration'
  }

  // Only service team is added. Add default DBA and DATA team
  if (config.teams.length === 1) {
    config.teams.push('dba')
    config.teams.push('data')
  }

  config.databases.map(dbConfig => {
    if (!dbConfig.directory) {
      dbConfig.directory = '.'
    }
    if (!dbConfig.migration_table) {
      dbConfig.migration_table = 'migrations'
    }
  })
  console.log('Config: ', config)

  return config
}
