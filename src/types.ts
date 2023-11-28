import { User } from './types.gha'

export type MigrationResponse = {
  source: 'atlas'
  response: string
}

export interface MigrationRunListResponse {
  migrationAvailable: boolean
  executionResponseList: MigrationResponse[]
  errMsg: string | null
}

export interface MigrationConfig {
  databaseUrl: string
  dir: string
  baseline?: string
  schema: string
  dryRun: boolean
}

export interface MatchTeamWithPRApproverResult {
  teamByName: { [key: string]: string[] }
  prApprovedUserListByTeam: { [key: string]: string[] }
  approvalMissingFromTeam: string[]
}

export interface RunMigrationResult {
  executionResponseList: MigrationResponse[]
  migrationAvailable: boolean
  ignore: boolean
}

export type MigrationMeta = {
  eventName: string
  actionName: string
  triggeredBy: User
  skipCommentWhenNoMigrationsAvailable?: boolean
} & (
  | {
      source: 'comment'
      commentId: number
      commentBody: string
    }
  | {
      source: 'review'
    }
  | {
      source: 'pr'
    }
)
