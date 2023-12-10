/**
 * Github Token Permission
 *  write:repo_hook: To send webhook to GitHUB to trigger custom action
 *
 * Fields Added
 * - GitHub PR Link: API Link for PR
 * - Github Repo Link: Used for dispatching webhook
 */
import JiraApi from 'jira-client'

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
  // https://{jiraDomain}.atlassian.net/rest/api/2/issue/{issueOrKey}/transitions
  // and pick "id" value
  statusIDInitial: string
  statusIDCompleted: string

  // To find custom field ID, use
  // https://{jiraDomain}.atlassian.net/secure/admin/ViewCustomFields.jspa
  // select field and pick "id" in URL (id=12344)
  // So value should be "customfield_12345"
  customFieldPRLink: string
  customFieldRepoLink: string

  customFieldApprovedByDataTeam: string
}

type JiraIssue = {
  id: string
  key: string
  self: string
}

type Comment = {
  id: string
  self: string
  body: string
}

type CreateTicketParams = {
  prNumber: number
  description: string
  assigneeName: string
  prLink: string
  repoAPIUrl: string
}

type EnsureIssueResponse = {
  alreadyExists: boolean
  issue: JiraIssue
}

class Client {
  #repoOwner: string
  #repoName: string
  #project: string
  #ticketLabel: string
  #issueType: string
  #statuses: {
    initial: string
    completed: string
  }
  #custom_fields: {
    prLink: string
    repoLink: string
  }
  #api: JiraApi

  constructor(config: ClientConfig) {
    const {
      repoOwner,
      repoName,
      apiToken,
      apiUser,
      jiraDomain,
      project,
      ticketLabel = 'db-migration',
      issueType = 'Story',
      statusIDInitial,
      statusIDCompleted,
      customFieldPRLink,
      customFieldRepoLink,
      customFieldApprovedByDataTeam
    } = config

    if (
      !repoOwner ||
      !repoName ||
      !apiToken ||
      !apiUser ||
      !jiraDomain ||
      !project ||
      !statusIDInitial ||
      !statusIDCompleted ||
      !customFieldPRLink ||
      !customFieldRepoLink ||
      !customFieldApprovedByDataTeam
    ) {
      throw new Error('Missing required arguments')
    }

    this.#repoOwner = repoOwner
    this.#repoName = repoName
    this.#project = project
    this.#ticketLabel = ticketLabel
    this.#issueType = issueType
    this.#statuses = {
      initial: statusIDInitial,
      completed: statusIDCompleted
    }
    this.#custom_fields = {
      prLink: customFieldPRLink,
      repoLink: customFieldRepoLink
    }

    this.#api = new JiraApi({
      protocol: 'https',
      host: `${jiraDomain}.atlassian.net`,
      username: apiUser,
      password: apiToken,
      apiVersion: '2',
      strictSSL: true
    })
  }

  getSearchToken(prNumber: number): string {
    return `${this.#repoOwner}/${this.#repoName}/PR#${prNumber}`
  }

  async #search(searchText: string): Promise<JiraIssue | null> {
    const jql = `project=${this.#project} AND labels=${this.#ticketLabel} AND ${searchText}`
    console.log(`Search Text: ${jql}`)

    const response = await this.#api.searchJira(jql, { maxResults: 2 })
    if (response.issues.length === 0) {
      return null
    } else if (response.issues.length > 1) {
      throw new Error(`Found multiple tickets for ${searchText}`)
    }
    return response.issues[0]
  }

  async searchIssue(prNumber: number): Promise<JiraIssue | null> {
    return this.#search(`summary~"${this.getSearchToken(prNumber)}"`)
  }

  /**
   * Get Jira issue by PR Link
   * **NOTE**: Not working as unable to find custom field ID
   * @param prLink
   * @returns
   */
  async getByPRLink(prLink: string): Promise<JiraIssue | null> {
    return await this.#search(`${this.#custom_fields.prLink} = "${prLink}"`)
  }

  async ensureIssue(createTicketParams: CreateTicketParams): Promise<EnsureIssueResponse> {
    // const issue = await this.getByPRLink(createTicketParams.prLink)
    const issue = await this.searchIssue(createTicketParams.prNumber)

    if (issue != null) {
      console.debug('Ticket already present', issue)
      return {
        alreadyExists: true,
        issue: {
          id: issue.id,
          key: issue.key,
          self: issue.self
        }
      }
    }

    console.debug('Creating new Ticket')
    return {
      alreadyExists: false,
      issue: await this.createIssue(createTicketParams)
    }
  }

  async addComment(issueId: string, message: string): Promise<Comment> {
    const comment = await this.#api.addComment(issueId, message)
    const retObj: Comment = {
      id: comment.id,
      self: comment.self,
      body: comment.body
    }
    return retObj
  }

  async updateComment(issueId: string, commentId: string, message: string): Promise<Comment> {
    const comment = await this.#api.updateComment(issueId, commentId, message)
    return {
      id: comment.id,
      self: comment.self,
      body: comment.body
    }
  }

  /**
   * Creates a Jira issue.
   *
   * @param createTicketParams - The parameters for creating the Jira issue.
   * @returns A promise that resolves to the created Jira issue.
   */
  async createIssue(createTicketParams: CreateTicketParams): Promise<JiraIssue> {
    const { prNumber, description, assigneeName, prLink, repoAPIUrl } = createTicketParams
    const createJiraTicketParams = {
      fields: {
        project: {
          key: this.#project
        },
        summary: this.getSearchToken(prNumber),
        issuetype: {
          name: this.#issueType
        },
        labels: [this.#ticketLabel],
        description,
        [this.#custom_fields.prLink]: prLink,
        [this.#custom_fields.repoLink]: repoAPIUrl
      }
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
      self: issue.self
    }
    console.debug('JIRA created: ', retObj)

    await this.transition(issue.id, this.#statuses.initial)

    /*
    {
      id: '196000',
      key: '{projectKey}-1',
      self: 'https://slicepay.atlassian.net/rest/api/2/issue/196000'
    }
    */
    return issue as JiraIssue
  }

  /**
   * Transitions an issue to a new state.
   * @param issueId The ID of the issue to transition.
   * @param transitionID The ID of the transition to perform.
   * @returns A promise that resolves when the transition is complete.
   */
  async transition(issueId: string, transitionID: string): Promise<void> {
    // This api does not return anything
    await this.#api.transitionIssue(issueId, {
      transition: {
        id: transitionID
      }
    })
  }
}

export default Client
