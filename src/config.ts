import path from 'path'

export interface Config {
  base_directory: string
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
  teams: string[]
  databases: DatabaseConfig[]
  aws_secret_provider: {
    path: string
  }
}

export interface TokenConfig {
  github_token: string
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
  const config: Config = require(process.env.MIGRATION_CONFIG_FILE || path.join(process.cwd(), './db.migration.json'))
  if (!config.base_directory) {
    config.base_directory = 'migrations'
  }

  if (!config.tokens) {
    config.tokens = {} as TokenConfig
  }
  if (!config.tokens.github_token) {
    config.tokens.github_token = 'GH_TOKEN'
  }
  if (!config.tokens.jira_token) {
    config.tokens.jira_token = 'JIRA_TOKEN'
  }
  if (!config.tokens.jira_user) {
    config.tokens.jira_user = 'JIRA_USER'
  }

  if (!config.jira) {
    throw new Error('jira config is missing')
  }
  if (!config.jira.issue_type) {
    config.jira.issue_type = 'Story'
  }
  if (!config.jira.ticket_label) {
    config.jira.ticket_label = 'db-migration'
  }

  if (!config.base_directory) {
    config.base_directory = 'migrations'
  }

  if (!config.teams) {
    config.teams = []
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
