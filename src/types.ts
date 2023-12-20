import { JiraIssue } from './client/jira'
import { User } from './types.gha'

export interface ChangedFileValidationError {
  errMsg: string
  migrationAvailable: boolean
  unmatched: string[]
}

export interface MigrationLintResponse {
  lintResponseList: LintExecutionResponse[]
  errMsg?: string
}

export interface MigrationRunListResponse {
  migrationAvailable: boolean
  executionResponseList: MigrationExecutionResponse[]
  errMsg?: string
}

export interface MigrationConfig {
  databaseUrl: string
  dir: string
  baseline?: string
  schema: string
  dryRun: boolean
  devUrl: string
  lintLatestFiles?: number
}

export interface MatchTeamWithPRApproverResult {
  teamByName: { [key: string]: string[] }
  prApprovedUserListByTeam: { [key: string]: string[] }
  approvalMissingFromTeam: string[]
}

export interface RunMigrationResult {
  executionResponseList: MigrationExecutionResponse[]
  migrationAvailable: boolean
  jiraIssue?: JiraIssue
  ignore: boolean
}

export type MigrationMeta = {
  eventName: string
  actionName: string
  triggeredBy: User
  // Set this to true only when PR event is received(i.e PR (re)opened, synchronized)
  ensureJiraTicket?: boolean
  lintRequired?: boolean
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

/**
 * Represents an error that occurred during the execution of a database migration version.
 */
export interface VersionExecutionError {
  /**
   * Gets the SQL statement that caused the error.
   * @returns The SQL statement.
   */
  getStatement(): string

  /**
   * Gets the error message associated with the execution error.
   * @returns The error message.
   */
  getMessage(): string
}

/**
 * Represents the response of executing a migration version.
 */
export interface MigrationVersionExecutionResponse {
  /**
   * Gets the name of the migration version.
   * @returns The name of the migration version.
   */
  getName(): string

  /**
   * Gets the version of the migration.
   * @returns The version of the migration.
   */
  getVersion(): string

  /**
   * Gets the description of the migration version.
   * @returns The description of the migration version.
   */
  getDescription(): string

  /**
   * Gets the list of applied SQL statements for the migration version.
   * @returns The list of applied SQL statements.
   */
  getAppliedStatements(): string[]

  /**
   * Checks if any SQL statements were applied for the migration version.
   * @returns `true` if SQL statements were applied, `false` otherwise.
   */
  hasAppliedStatements(): boolean

  /**
   * Gets the error encountered during the execution of the migration version, if any.
   * @returns The error encountered during execution, or `undefined` if no error occurred.
   */
  getVersionError(): VersionExecutionError | undefined
}

/**
 * Represents the response of a migration execution.
 */
export interface MigrationExecutionResponse {
  /**
   * Gets the source of the migration.
   * @returns The source of the migration.
   */
  getSource(): string

  /**
   * Checks if there are any migrations.
   * @returns True if there are migrations, false otherwise.
   */
  hasMigrations(): boolean

  /**
   * Gets the first error encountered during migration execution.
   * @returns The first error encountered, or undefined if there are no errors.
   */
  getFirstError(): string | undefined

  /**
   * Gets the executed migrations.
   * @returns An array of executed migration versions.
   */
  getExecutedMigrations(): MigrationVersionExecutionResponse[]
}

/**
 * Represents a Formatter object for github or jira
 */
export interface Formatter {
  success: string
  failure: string
  hSep: string
  rSep: string
  /**
   * Code block within table column allowed
   */
  tableCodeBlockAllowed: boolean
  /**
   * Table column value escape
   * @param value
   * @returns
   */
  cEsc: (value: string) => string
  headerBuilder: (headers: string[]) => string
  userRef: (login: string) => string
  linkBuilder: (text: string, url: string) => string
  quoteBuilder: (text: string) => string
  sqlStatementBuilder: (text: string, header?: string) => string
}

/**
 * Represents a lint diagnostic error.
 */
export interface LintDiagnosticError {
  /**
   * Gets the error message.
   * @returns The error message.
   */
  getMessage(): string

  /**
   * Gets the error code.
   * @returns The error code.
   */
  getErrorCode(): string

  getPosition(): number

  /**
   * Gets the help URL.
   * @returns The help URL.
   */
  getHelpUrl(): string
}

export interface LintFileResult {
  getName(): string
  getDiagnostics(): LintDiagnosticError[]
}

/**
 * Represents the response of a lint execution.
 */
export interface LintExecutionResponse {
  getFileLintResults(): LintFileResult[]

  getMigrationDirectory(): string

  getFirstError(): string | undefined
}
