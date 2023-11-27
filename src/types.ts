import { User } from './types.gha'

export interface MigrationRunListResponse {
  migrationAvailable: boolean
  migratedFileList: string[][]
  errMsg: string | null
}

export interface MigrationConfig {
  databaseUrl: string
  dir: string
  migrationsTable: string
  direction: 'up'
  checkOrder: true
  dryRun: boolean
}

export interface MatchTeamWithPRApproverResult {
  teamByName: { [key: string]: string[] }
  prApprovedUserListByTeam: { [key: string]: string[] }
  approvalMissingFromTeam: string[]
}

export interface RunMigrationResult {
  migratedFileList: string[][]
  ignore: boolean
}

export type MigrationMeta = {
  eventName: string
  actionName: string
  triggeredBy: User
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
