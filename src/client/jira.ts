import JiraApi, { IssueObject } from 'jira-client'
import * as core from '@actions/core'
import { CustomFields, Config, JiraIssue, JiraComment, CreateTicketParams, JiraClient } from '../../src/types.jira'
import { executeWithRetry } from '../util'

class Client implements JiraClient {
  #project: string
  #ticketLabel: string
  #issueType: string
  #schemaDriftTicketLabel: string
  #schemaDriftIssueType: string
  #fields: CustomFields
  #api: JiraApi

  constructor(api: JiraApi, config: Config) {
    const { project } = config

    if (!project) {
      throw new Error('Jira config missing project')
    }

    this.#project = project
    this.#ticketLabel = config.label
    this.#issueType = config.issueType
    this.#schemaDriftTicketLabel = config.schemaDriftLabel
    this.#schemaDriftIssueType = config.schemaDriftIssueType
    this.#fields = config.fields || {}
    this.#api = api
  }

  async addComment(issueId: string, message: string): Promise<JiraComment> {
    const comment = await executeWithRetry(async () => this.#api.addComment(issueId, message), 'AddComment')
    const retObj: JiraComment = {
      id: comment.id,
      self: comment.self,
      body: comment.body
    }
    return retObj
  }

  async #search(searchText: string): Promise<JiraIssue | null> {
    const jql = `project="${this.#project}" AND ${searchText}`

    core.debug(`Search Jira: ${jql}`)
    const response = await executeWithRetry(async () => this.#api.searchJira(jql, { maxResults: 2 }), 'SearchIssue')
    if (response.issues.length === 0) {
      return null
    } else if (response.issues.length > 1) {
      throw new Error(`Found multiple tickets for ${jql}`)
    }
    return response.issues[0]
  }

  async findIssue(prLink: string): Promise<JiraIssue | null> {
    return await this.#search(`"${this.#fields.prLabel || this.#fields.pr}" = "${prLink}"`)
  }

  async findSchemaDriftIssue(repoLink: string, doneStatus: string): Promise<JiraIssue | null> {
    return await this.#search(
      `"labels" = "${this.#schemaDriftTicketLabel}" AND "${this.#fields.repoLabel}" = "${repoLink}" AND status != "${doneStatus}"`
    )
  }

  async createIssue(createTicketParams: CreateTicketParams): Promise<JiraIssue> {
    const { description, assigneeName } = createTicketParams
    const labels = [this.#ticketLabel]
    const createJiraTicketParams: IssueObject = {
      fields: {
        project: {
          key: this.#project
        },
        issuetype: {
          name: this.#issueType
        },
        description,
        summary: createTicketParams.repoLink,
        [this.#fields.repo]: createTicketParams.repoLink
      }
    }

    if ('isSchemaDrift' in createTicketParams) {
      labels.push(this.#schemaDriftTicketLabel)
      createJiraTicketParams.fields.issuetype.name = this.#schemaDriftIssueType
    } else {
      createJiraTicketParams.fields.summary = createTicketParams.prLink
      createJiraTicketParams.fields[this.#fields.pr] = createTicketParams.prLink
    }
    createJiraTicketParams.fields.labels = labels

    if (assigneeName) {
      createJiraTicketParams.fields.assignee = {
        name: assigneeName
      }
    }

    const issue = await executeWithRetry(async () => this.#api.addNewIssue(createJiraTicketParams), 'AddNewIssue')
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
