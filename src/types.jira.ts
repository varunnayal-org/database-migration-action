import { IssueObject } from 'jira-client'

/**
 * Represents the custom fields for JIRA Issue.
 *
 * To get the customField ID use following URL format
 * https://{jiraDomain}/secure/admin/ViewCustomFields.jspa
 * eg:
 * https://org.atlassian.net/secure/admin/ViewCustomFields.jspa
 */
export type CustomFields = {
  /**
   * Add PR Link to JIRA Issue.
   */
  pr: string
  /**
   * PR Label used for searching. If missing "pr" field is used.
   */
  prLabel: string

  /**
   * Add Repo Link to JIRA Issue.
   */
  repo: string

  /**
   * Repo Label used for searching ticket for schema drift
   */
  repoLabel: string

  /**
   * List of approvals required for PR to be merged.
   */
  driApprovals: string[]
}

/**
 * Represents the configuration for JIRA integration.
 */
export interface Config {
  /**
   * JIRA Host.
   */
  host: string

  /**
   * JIRA Project Key.
   */
  project: string

  /**
   * Label to add on JIRA Issue. If empty, label is ignored.
   * It's value is derived from db migration configuration file via jiraLabel field.
   */
  label: string

  /**
   * JIRA Issue type. Defaults to 'Story'.
   */
  issueType: string

  /**
   * JIRA Issue type for Schema drifts. Defaults to 'Bug'.
   */
  schemaDriftIssueType: string

  /**
   * Label to add on JIRA issue when schema drift is captured.
   * Defaults to "schema-drift"
   */
  schemaDriftLabel: string

  /**
   * Custom fields for JIRA Issue.
   */
  fields: CustomFields

  /**
   * Status of fields.driApprovals fields
   * Default: DONE
   */
  approvalStatus?: string

  /**
   * Status when JIRA is marked as completed
   * Default: Done
   */
  doneValue: string
}

export type JiraIssue = {
  id: string
  key: string
  self: string
  fields: IssueObject
}

export type JiraComment = {
  id: string
  self: string
  body: string
}

export type CreateTicketParams1 = {
  prNumber: number
  title: string
  description: string
  assigneeName?: string
  prLink: string
  repoLink: string
}

export type CreateTicketParams = {
  description: string
  assigneeName?: string
  repoLink: string
} & (
  | {
      prNumber: number
      prLink: string
    }
  | {
      isSchemaDrift: true
    }
)

/**
 * Represents the JIRA Client.
 */
export interface JiraClient {
  /**
   * Adds a new comment to issue.
   *
   * @param issueId
   * @param comment
   *
   * @returns A promise that resolves to the created comment.
   */
  addComment(issueId: string, comment: string): Promise<JiraComment>

  /**
   * Finds a JIRA issue by PR link.
   * @param prLink
   *
   * @returns A promise that resolves to the JIRA issue or null if not found.
   */
  findIssue(prLink: string): Promise<JiraIssue | null>

  /**
   * Finds a JIRA issue that has been created by schema drift
   *
   * @param repoLink - Repository link
   * @param doneStatus - Resolved status for JIRA ticket
   */
  findSchemaDriftIssue(repoLink: string, doneStatus: string): Promise<JiraIssue | null>

  /**
   * Creates a JIRA issue.
   *
   * @param createTicketParams
   *
   * @returns A promise that resolves to the created JIRA issue.
   */
  createIssue(createTicketParams: CreateTicketParams): Promise<JiraIssue>
}
