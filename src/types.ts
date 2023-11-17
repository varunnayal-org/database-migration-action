// #region GitHub
export interface GitHubEvent {
  organization: {
    login: string
  }
  repository: {
    owner: {
      login: string
    }
    name: string
    html_url: string
  }
  issue: {
    pull_request: {
      url: string
    }
    number: number
    repository_url: string
  }
  comment: {
    id: number
    body: string
    user: {
      login: string
    }
  }
}

// #region JIRA
export interface JiraEvent {
  event_type: string
  client_payload: JiraClientPayload
}

export interface JiraClientPayload {
  actionName: string
  issue: JiraIssue
  comment: JiraComment
  github: JiraGitHub
}

export interface JiraIssue {
  id: string
  key: string
}

export interface JiraComment {
  id: string
  body: string
  owner: JiraOwner
}

export interface JiraOwner {
  id: string
  name: string
  email: string
}

export interface JiraGitHub {
  pr_url: string
}
// #endregion

export interface MigrationRunListResponse {
  migrationAvailable: boolean
  migratedFileList: string[][]
  errMsg: string | null
}

export interface MigrationConfig {
  databaseUrl: string
  dir: string
  migrationsTable: string
  direction: 'up' | 'down'
  checkOrder: boolean
  dryRun: boolean
}
