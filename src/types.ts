// eslint-disable-next-line import/no-unresolved
import { OctokitOptions } from '@octokit/core/dist-types/types'

import { Config as JiraConfig, JiraClient, JiraComment, JiraIssue } from './types.jira'
import {
  User,
  PullRequest,
  GHClient,
  IssueCreateCommentResponse,
  IssueUpdateCommentResponse,
  PullRequestUpdateResponse,
  Repository
} from './types.gha'
import { VaultClient } from './client/vault/types'

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
   * If present, then member of these teams should approve the PR before migration can be run.
   */
  approvalTeams: string[]

  /**
   * GitHub teams that own the repository.
   * The member of this team can run migration
   */
  ownerTeams: string[]

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
   * Combination of approvalTeams and ownerTeams.
   */
  allTeams: string[]

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
  jira?: JiraConfig

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

  /**
   * Key under which db connection string resides
   */
  envName: string

  /**
   * Baseline version. Passed as "--baseline" flag in "atlas migrate apply" command
   */
  baseline?: string

  /**
   * Schema where revision table resides. Defaults to "public"
   */
  revisionSchema: string
}

/**
 * Represents an error that occurred when validating a changed file.
 */
export interface ChangedFileValidationError {
  /**
   * The error message.
   */
  errMsg: string

  /**
   * Indicates whether a migration is available.
   */
  migrationAvailable: boolean

  /**
   * An array of unmatched items.
   */
  unmatched: string[]
}

/**
 * Represents the response from a migration lint operation.
 */
export interface MigrationLintResponse {
  /**
   * An array of lint execution responses.
   */
  lintResponseList: LintExecutionResponse[]

  /**
   * An optional error message.
   */
  errMsg?: string

  /**
   * Indicates whether all errors can be skipped.
   */
  canSkipAllErrors: boolean
}

/**
 * Represents the response from a migration run list operation.
 */
export interface MigrationRunListResponse {
  /**
   * Indicates whether a migration is available.
   */
  migrationAvailable: boolean

  /**
   * An array of migration execution responses.
   */
  executionResponseList: MigrationExecutionResponse[]

  /**
   * An optional error message.
   */
  errMsg?: string
}

/**
 * Represents the response from drift operations.
 */
export interface DriftRunListResponse {
  /**
   * Specifies whether schema drift exists
   */
  hasSchemaDrifts: boolean

  /**
   * An array of drift execution responses.
   */
  drifts: DriftExecutionResponse[]

  /**
   * An optional error message.
   */
  errMsg?: string
}

/**
 * Represents the configuration for a migration.
 */
export interface MigrationConfig {
  /**
   * The URL of the database.
   */
  databaseUrl: string

  /**
   * The original directory.
   */
  originalDir: string

  /**
   * The relative directory.
   */
  relativeDir: string

  /**
   * The directory.
   */
  dir: string

  /**
   * An optional baseline.
   */
  baseline?: string

  /**
   * Indicates whether to perform a dry run.
   */
  dryRun: boolean

  /**
   * The URL for development.
   */
  devUrl: string

  /**
   * An optional number of latest files to lint.
   */
  lintLatestFiles?: number

  /**
   * Schema where revision table resides. Defaults to "public"
   */
  revisionSchema: string
}

/**
 * Represents the result of matching a team with a PR approver.
 */
export interface MatchTeamWithPRApproverResult {
  /**
   * An object where the keys are team names and the values are arrays of team members.
   */
  teamByName: { [key: string]: string[] }

  /**
   * An object where the keys are team names and the values are arrays of PR approved users.
   */
  prApprovedUserListByTeam: { [key: string]: string[] }

  /**
   * An array of teams that are missing approval.
   */
  approvalMissingFromTeam: string[]
}

/**
 * Represents the result of running a migration.
 */
export interface RunMigrationResult {
  /**
   * An optional array of responses from a migration lint operation.
   */
  lintResponseList?: MigrationLintResponse

  /**
   * An array of responses from executing the migration.
   */
  executionResponseList: MigrationExecutionResponse[]

  /**
   * Indicates whether a migration is available.
   */
  migrationAvailable: boolean

  /**
   * An optional Jira issue associated with the migration.
   */
  jiraIssue?: JiraIssue

  /**
   * Indicates whether the migration should be ignored.
   */
  ignore: boolean
}

/**
 * Represents an event in the system.
 *
 * This type is a combination of a base object and one of three possible shapes,
 * depending on the source of the event ('comment', 'review', or 'pr').
 */
export type MigrationMeta = {
  /**
   * The name of the event.
   */
  eventName: string

  /**
   * The name of the action that triggered the event.
   */
  actionName: string

  /**
   * The user who triggered the event.
   */
  triggeredBy: User

  /**
   * Set this to true only when PR event is received(i.e PR (re)opened, synchronized).
   * This indicates whether a Jira ticket should be ensured for the event.
   */
  ensureJiraTicket?: boolean

  /**
   * Indicates whether linting is required for the event.
   */
  lintRequired?: boolean

  /**
   * Indicates whether to skip commenting when no migrations are available.
   */
  skipCommentWhenNoMigrationsAvailable?: boolean
} & (
  | {
      /**
       * Indicates that the event source is a comment.
       */
      source: 'comment'

      /**
       * The ID of the comment.
       */
      commentId: number

      /**
       * The body of the comment.
       */
      commentBody: string
    }
  | {
      /**
       * Indicates that the event source is a review.
       */
      source: 'review'
    }
  | {
      /**
       * Indicates that the event source is a PR.
       */
      source: 'pr'
    }
)

export type DriftStatement = {
  comment: string
  command: string
}

export interface DriftExecutionResponse {
  getStatements(): DriftStatement[]
  getError(): string | undefined
}

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
 * ITextBuilder is an interface that defines the structure for text building operations.
 * It includes methods for linting, running, setting a title, and setting a description.
 */
export interface ITextBuilder {
  /**
   * Takes an array of LintExecutionResponse objects and returns a string.
   * This method is used to process linting results.
   *
   * @param {LintExecutionResponse[]} lintResults - An array of linting results.
   * @returns {string} - A string representation of the linting results.
   */
  lint(lintResults: LintExecutionResponse[]): string

  /**
   * Takes an array of MigrationRunListResponse objects and returns a string.
   * This method is used to process migration execution results.
   *
   * @param {MigrationRunListResponse} result - Run results.
   * @returns {string} - A string representation of the run results.
   */
  run(result: MigrationRunListResponse): string

  /**
   * Takes DriftRunListResponse and returns a string.
   * This method is used to process drift execution results
   *
   * @param {DriftRunListResponse} drifts - Drift execution result
   * @returns {string} - A string representation of the drifting result
   */
  drift(drifts: DriftRunListResponse): string

  /**
   * Takes a prefix string and returns a string.
   * This method is used to set a title.
   *
   * @param {string} prefix - A prefix for the title.
   * @returns {string} - A string representation of the title.
   */
  title(prefix: string): string

  /**
   * Takes a comment string and returns a string.
   * This method is used to set a description.
   *
   * @param {string} comment - A comment for the description.
   * @returns {string} - A string representation of the description.
   */
  description(comment: string): string
}

/**
 * Formatter is an interface that defines the structure for formatting operations.
 * It includes methods and properties for building headers, user references, links, quotes, and SQL statements,
 * as well as escaping column values and defining success, failure, horizontal separator, row separator, and skip messages.
 */
export interface Formatter {
  /**
   * An emoji representing a success message.
   */
  success: string

  /**
   * An emoji representing a failure message.
   */
  failure: string

  /**
   * An emoji representing a horizontal separator.
   */
  hSep: string

  /**
   * A string representing a row separator.
   */
  rSep: string

  /**
   * A string representing a skip message.
   */
  skip: string

  /**
   * A boolean indicating whether a code block within a table column is allowed.
   */
  tableCodeBlockAllowed: boolean

  bold: (value: string) => string
  italic: (value: string) => string
  inlineCode: (value: string) => string

  /**
   * A function that escapes a column value.
   *
   * @param {string} value - The value to escape.
   * @returns {string} - The escaped value.
   */
  cEsc: (value: string) => string

  /**
   * A function that builds a header.
   *
   * @param {string[]} headers - The headers to build.
   * @returns {string} - The built header.
   */
  headerBuilder: (headers: string[]) => string

  /**
   * A function that builds a user reference.
   *
   * @param {string} login - The login to reference.
   * @returns {string} - The built user reference.
   */
  userRef: (login: string) => string

  /**
   * A function that builds a link.
   *
   * @param {string} text - The text of the link.
   * @param {string} url - The URL of the link.
   * @returns {string} - The built link.
   */
  linkBuilder: (text: string, url: string) => string

  /**
   * A function that builds a quote.
   *
   * @param {string} text - The text of the quote.
   * @returns {string} - The built quote.
   */
  quoteBuilder: (text: string) => string

  /**
   * A function that builds a SQL statement.
   *
   * @param {string} text - The text of the SQL statement.
   * @param {string} [header] - An optional header for the SQL statement.
   * @returns {string} - The built SQL statement.
   */
  sqlStatementBuilder: (text: string, header?: string) => string
}

/**
 * Represents a lint diagnostic error.
 */
export interface LintDiagnosticError {
  /**
   * Gets the error message.
   * @returns {string} The error message.
   */
  getMessage(): string

  /**
   * Gets the error code.
   * @returns {string} The error code.
   */
  getErrorCode(): string

  /**
   * Gets the position of the error in the file.
   * @returns {number} The position of the error.
   */
  getPosition(): number

  /**
   * Gets the help URL for the error.
   * @returns {string} The help URL.
   */
  getHelpUrl(): string

  /**
   * Checks if the error is skipped or not.
   * @returns {boolean} True if the error is skipped, false otherwise.
   */
  isSkipped(): boolean
}

/**
 * Represents the result of linting a file.
 */
export interface LintFileResult {
  /**
   * Gets the name of the file.
   * @returns {string} The name of the file.
   */
  getName(): string

  /**
   * Gets the diagnostics for the file.
   * @returns {LintDiagnosticError[]} An array of lint diagnostic errors.
   */
  getDiagnostics(): LintDiagnosticError[]
}

/**
 * Represents an interface for managing lint results and migration directory.
 */
export interface LintExecutionResponse {
  /**
   * Gets the lint results for the file.
   * @returns {LintFileResult[]} An array of lint file results.
   */
  getFileLintResults(): LintFileResult[]

  /**
   * Gets the migration directory.
   * @returns {string} The migration directory.
   */
  getMigrationDirectory(): string

  /**
   * Gets the first error.
   * @returns {string | undefined} The first error if exists, undefined otherwise.
   */
  getFirstError(): string | undefined

  /**
   * Checks if all errors can be skipped.
   * @returns {boolean} True if all errors can be skipped, false otherwise.
   */
  canSkipAllErrors(): boolean
}

/**
 * Represents the response from a GitHub notification operation.
 */
export type GithubNotifyResponse = IssueCreateCommentResponse | IssueUpdateCommentResponse | PullRequestUpdateResponse

/**
 * Represents the response from a notification operation.
 */
export type NotifyResponse = {
  /**
   * Represents the response from a GitHub notification operation.
   */
  githubComment: GithubNotifyResponse

  /**
   * An optional Jira issue associated with the notification.
   */
  jiraIssue?: JiraIssue

  /**
   * An optional Jira comment associated with the notification.
   */
  jiraComment?: JiraComment
}

/**
 * Represents the parameters for a notification operation.
 */
export type NotifyParams = {
  pr: PullRequest

  migrationMeta: MigrationMeta

  /**
   * The response from a migration run list operation.
   */
  migrationRunListResponse: MigrationRunListResponse

  /**
   * An optional array of responses from a migration lint operation.
   */
  lintResponseList?: MigrationLintResponse

  /**
   * Indicates whether to add a migration run response for linting.
   */
  addMigrationRunResponseForLint?: boolean

  /**
   * An optional Jira issue associated with the notification.
   */
  jiraIssue?: JiraIssue | null | undefined

  /**
   * An optional validation error from a changed file.
   */
  changedFileValidation?: ChangedFileValidationError

  /**
   * Indicates whether to close the PR.
   */
  closePR?: boolean
}

export type DriftParams = {
  /**
   * Drift execution response
   */
  driftRunListResponse: DriftRunListResponse

  /**
   * An optional jira issue associated with the drift error
   */
  jiraIssue?: JiraIssue | null | undefined

  repo: Repository
}

export type DriftResponse = {
  /**
   * An optional Jira issue associated with the schema drift.
   */
  jiraIssue?: JiraIssue

  /**
   * An optional Jira comment associated with the schema drift.
   */
  jiraComment?: JiraComment
}

export interface Notifier {
  notify(params: NotifyParams): Promise<NotifyResponse>
  drift(drifts: DriftParams): Promise<DriftResponse>
}

export interface Builder {
  /**
   * Returns a hydrated vault client ready to use for GitHub Actions.
   * If an AWS secret store is configured, it creates an AWSClient using the SecretsManagerClient
   * from the AWS SDK and the specified secret store. Otherwise, it throws an error.
   *
   * @returns A vault client.
   * @throws {Error} If no vault is configured.
   */
  getVault(): VaultClient

  /**
   * Builds JIRA client
   *
   * @param config - An optional parameter of type `JiraConfig`. This represents the configuration for the Jira client.
   *
   * @returns A `JiraClient` object if the configuration is valid, or `null` if the configuration is not valid or not provided.
   * @throws {Error} If invalid configuration is provided.
   *
   * This method is used to get a Jira client. If a `JiraConfig` is provided and is valid, a `JiraClient` object is returned. If the `JiraConfig` is not provided or is not valid, `null` is returned.
   */
  getJira(config?: JiraConfig): JiraClient | null

  /**
   * Builds Github Client
   *
   * @param opts - An optional parameter of type `OctokitOptions`. This represents the options for the Octokit client.
   *
   * @returns A `GHClient` object.
   * @throws {Error} If invalid configuration is provided.
   *
   */
  getGithub(opts?: OctokitOptions): GHClient

  /**
   * `getNotifier` is a method in the `factory.ts` file.
   *
   * @param dryRun - A boolean indicating whether the notifier service should run in dry run mode.
   * @param config - A `Config` object representing the configuration.
   * @param ghClient - A `GHClient` object representing the GitHub client.
   * @param jiraClient - A `JiraClient` object or null representing the Jira client.
   *
   * @returns A `Notifier` object.
   *
   * This method is used to create a new `NotifierService` object with the specified parameters.
   */
  getNotifier(dryRun: boolean, config: Config, ghClient: GHClient, jiraClient: JiraClient | null): Notifier
}
