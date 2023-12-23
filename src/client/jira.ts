import JiraApi, { IssueObject } from 'jira-client'
import * as core from '@actions/core'
import { getInput } from '../util'

type CustomFields = {
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
  repo?: string
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
   * JIRA Issue type. Defaults to 'Task'.
   */
  issueType: string

  /**
   * Custom fields for JIRA Issue.
   */
  fields: CustomFields

  /**
   * Status of fields.driApprovals fields
   */
  approvalStatus?: string

  /**
   * Status when JIRA is marked as DONE
   */
  doneValue: string
}

export type ClientConfig = {
  repoOwner: string
  repoName: string
  apiToken: string
  apiUser: string
  jiraDomain: string
  project: string
  ticketLabel?: string
  issueType?: string
  // To find issue status ID, use
  // https://{jiraDomain}/rest/api/2/issue/{issueOrKey}/transitions
  // and pick "id" value
  statusIDInitial: string
  statusIDCompleted: string

  // To find custom field ID, use
  // https://{jiraDomain}/secure/admin/ViewCustomFields.jspa
  // select field and pick "id" in URL (id=12344)
  // So value should be "customfield_12345"
  customFieldPRLink: string
  customFieldRepoLink: string

  customFieldApprovedByDataTeam: string
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

type CreateTicketParams = {
  prNumber: number
  title: string
  description: string
  assigneeName?: string
  prLink: string
  repoLink: string
}

class Client {
  #project: string
  #ticketLabel: string
  #issueType: string
  #fields: CustomFields
  #api: JiraApi

  constructor(username: string, token: string, config: Config) {
    const { host, project } = config

    if (!username || !token || !host || !project) {
      throw new Error('Missing required arguments')
    }

    this.#project = project
    this.#ticketLabel = config.label || ''
    this.#issueType = config.issueType || 'Task'
    this.#fields = config.fields || {}
    this.#api = new JiraApi({
      protocol: 'https',
      host,
      username,
      password: token,
      apiVersion: '2',
      strictSSL: true
    })
  }

  static fromEnv(config?: Config): Client | null {
    if (config) {
      return new Client(getInput('jira_username'), getInput('jira_password'), config)
    }
    return null
  }

  async addComment(issueId: string, message: string): Promise<JiraComment> {
    const comment = await this.#api.addComment(issueId, message)
    const retObj: JiraComment = {
      id: comment.id,
      self: comment.self,
      body: comment.body
    }
    return retObj
  }

  async #search(searchText: string): Promise<JiraIssue | null> {
    const jql = `project="${this.#project}" AND ${searchText}`
    core.debug(`Jira Search Text: [${jql}]`)

    const response = await this.#api.searchJira(jql, { maxResults: 2 })
    if (response.issues.length === 0) {
      return null
    } else if (response.issues.length > 1) {
      throw new Error(`Found multiple tickets for ${searchText}`)
    }
    return response.issues[0]
  }

  async findIssue(prLink: string): Promise<JiraIssue | null> {
    return await this.#search(`"${this.#fields.prLabel || this.#fields.pr}" = "${prLink}"`)
  }

  /**
   * Creates a Jira issue.
   *
   * @param createTicketParams - The parameters for creating the Jira issue.
   * @returns A promise that resolves to the created Jira issue.
   */
  async createIssue(createTicketParams: CreateTicketParams): Promise<JiraIssue> {
    const { description, assigneeName, prLink } = createTicketParams
    const createJiraTicketParams: IssueObject = {
      fields: {
        project: {
          key: this.#project
        },
        summary: createTicketParams.prLink,
        issuetype: {
          name: this.#issueType
        },
        labels: [this.#ticketLabel],
        description,
        [this.#fields.pr]: prLink
      }
    }

    if (this.#fields.repo) {
      createJiraTicketParams.fields[this.#fields.repo] = createTicketParams.repoLink
    }

    if (assigneeName) {
      createJiraTicketParams.fields.assignee = {
        name: assigneeName
      }
    }

    const issue = await this.#api.addNewIssue(createJiraTicketParams)
    const retObj: JiraIssue = {
      id: issue.id,
      key: issue.key,
      self: issue.self,
      fields: issue.fields
    }
    core.debug(`JIRA created: ${retObj.key} (id=${retObj.id})`)

    /*
    {
      id: '{number}',
      key: '{projectKey}-1',
      self: 'https://{org}.atlassian.net/rest/api/2/issue/{number}'
    }
    */
    return issue as JiraIssue
  }
}

export default Client
