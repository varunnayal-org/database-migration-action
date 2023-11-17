// import axios, { AxiosInstance } from 'axios'
import axios from 'axios'

interface ClientConfig {
  repoOwner: string
  repoName: string
  apiToken: string
  apiUser: string
  jiraDomain: string
  project: string
  ticketLabel?: string
  issueType?: string
  statusIDInitial: string
  statusIDCompleted: string
  customFieldPRLink: string
  customFieldRepoLink: string
}

interface JiraIssue {
  id: string
  key: string
  self: string
}

interface CreateJiraTicketResponse {
  alreadyExists: boolean
  issue: JiraIssue
}

interface Comment {
  id: string
  self: string
  body: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class JiraAPIError<T = any> extends Error {
  data: T
  statusCode: number

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(message: string, statusCode: number, data: any) {
    super(message)
    this.name = 'JiraAPIError'
    this.statusCode = statusCode || 500
    this.data = data
  }
}

class Client {
  #repoName: string
  #repoOwner: string
  // #apiToken: string
  // #apiUser: string
  #project: string
  #ticketLabel: string
  #issueType: string
  #statusIDInitial: string
  #statusIDCompleted: string
  #customFieldPRLink: string
  #customFieldRepoLink: string
  #baseURL: string
  #client: axios.AxiosInstance

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
      customFieldRepoLink
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
      !customFieldRepoLink
    ) {
      throw new Error('Missing required arguments')
    }

    this.#repoName = repoName
    this.#repoOwner = repoOwner
    this.#project = project
    this.#ticketLabel = ticketLabel
    this.#issueType = issueType
    this.#statusIDInitial = statusIDInitial
    this.#statusIDCompleted = statusIDCompleted
    this.#customFieldPRLink = customFieldPRLink
    this.#customFieldRepoLink = customFieldRepoLink
    this.#baseURL = `https://${jiraDomain}.atlassian.net/rest/api/2`

    this.#client = axios.create({
      baseURL: `https://${jiraDomain}.atlassian.net/rest/api/2`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiUser}:${apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    })
  }

  getSearchToken(prNumber: number): string {
    return `${this.#repoOwner}/${this.#repoName}/PR#${prNumber}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async #makeAPICall<T = any>(useCase: string, method: 'get' | 'post' | 'put', url: string, data?: any): Promise<T> {
    try {
      const response = await this.#client[method](url, data)
      return response.data as T
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      if (ex.response) {
        throw new JiraAPIError(
          `${ex.code} ${ex.message} (path=${ex.request?.path})(use_case=${useCase})`,
          ex.response.data || {},
          ex.response.status
        )
      }
      throw ex
    }
  }

  async #search(searchText: string): Promise<JiraIssue | null> {
    const jql = `project=${this.#project} AND labels=${this.#ticketLabel} AND ${searchText}`
    console.log(`Search Text: ${jql}`)
    const response = await this.#makeAPICall<{ issues: JiraIssue[] }>(`Search ${searchText}`, 'get', '/search', {
      params: {
        jql
      }
    })

    if (response.issues.length === 0) {
      return null
    } else if (response.issues.length > 1) {
      throw new Error(`Found multiple tickets for ${searchText}`)
    }
    return response.issues[0]
  }

  async searchJiraTicket(prNumber: number): Promise<JiraIssue | null> {
    return this.#search(`summary~"${this.getSearchToken(prNumber)}"`)
  }

  async ensureJiraTicket(
    prNumber: number,
    description: string,
    assigneeName: string | null,
    prLink: string,
    repoAPIUrl: string
  ): Promise<CreateJiraTicketResponse> {
    const issue = await this.searchJiraTicket(prNumber)

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
      issue: await this.createJiraTicket(prNumber, description, assigneeName, prLink, repoAPIUrl)
    }
  }

  async addComment(issueId: string, message: string): Promise<Comment> {
    const comment = await this.#makeAPICall<Comment>('Add Comment', 'post', `/issue/${issueId}/comment`, {
      body: message
    })

    return {
      id: comment.id,
      self: comment.self,
      body: comment.body
    }
  }

  async updateComment(issueId: string, commentId: string, message: string): Promise<Comment> {
    const comment = await this.#makeAPICall<Comment>(
      'Update Comment',
      'put',
      `/issue/${issueId}/comment/${commentId}`,
      {
        body: message
      }
    )

    return {
      id: comment.id,
      self: comment.self,
      body: comment.body
    }
  }

  async createJiraTicket(
    prNumber: number,
    description: string,
    assigneeName: string | null,
    prLink: string,
    repoAPIUrl: string
  ): Promise<JiraIssue> {
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
        [this.#customFieldPRLink]: prLink,
        [this.#customFieldRepoLink]: repoAPIUrl
      }
    }
    if (assigneeName) {
      createJiraTicketParams.fields.assignee = {
        name: assigneeName
      }
    }
    const issue = await this.#makeAPICall<JiraIssue>('Create Ticket', 'post', '/issue', createJiraTicketParams)

    console.debug('JIRA created: ', issue)

    await this.transition(issue.id, this.#statusIDInitial)

    return issue
  }

  async transition(issueId: string, transitionID: string): Promise<void> {
    try {
      await this.#makeAPICall('Transition Issue', 'post', `/issue/${issueId}/transitions`, {
        transition: {
          id: transitionID
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      console.error(`Unable to transition issue ${issueId} to ${this.#statusIDInitial}`, ex)
    }
  }
}

export default Client
