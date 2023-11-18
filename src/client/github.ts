import * as core from '@actions/core'

import { getOctokit } from '@actions/github'
import { getEnv, getInput } from '../util'
// eslint-disable-next-line import/no-unresolved
import { OctokitOptions } from '@octokit/core/dist-types/types'
// eslint-disable-next-line import/named
import { RestEndpointMethodTypes } from '@octokit/rest'
// eslint-disable-next-line import/no-unresolved
import { OctokitResponse } from '@octokit/types'
import { MinimalPRInfo } from '../types'

export type GithubClient = ReturnType<typeof getOctokit> // InstanceType<typeof GitHub>
export type PullRequestGetResponse = RestEndpointMethodTypes['pulls']['get']['response']['data']
export type IssueUpdateCommentResponse = RestEndpointMethodTypes['issues']['updateComment']['response']['data']
export type IssueCreateCommentResponse = RestEndpointMethodTypes['issues']['createComment']['response']['data']
export type IssueAddLabelResponse = RestEndpointMethodTypes['issues']['addLabels']['response']['data']
export type PullRequestGetReviewList = RestEndpointMethodTypes['pulls']['listReviews']['response']['data']
export type RepoGetCollaboratorListResponse = RestEndpointMethodTypes['repos']['listCollaborators']['response']['data']

export interface GithubPRCommentMinimal {
  action: string
  comment: {
    body: string
    id: number
    user: {
      login: string
    }
  }
  issue: {
    number: number
    pull_request: {
      url: string
    }
    repository_url: string
    user_not_required: {
      login: string
    }
  }
  organization: {
    login: string
  }
  repository: {
    name: string
    html_url: string
    owner: {
      login: string
    }
  }
  sender_not_required: {
    login: string
  }
}

export interface MatchingTeamsResponse {
  organization: {
    teams: {
      nodes: {
        name: string
      }[]
      pageInfo: {
        hasNextPage: boolean
        endCursor: string
      }
    }
  }
}

export interface PRInfo {
  author: string
  baseBranch: string
  isDraft: boolean
  isOpen: boolean
  labels: string[]
  state: string
}

function buildOctokit(token: string, opts: OctokitOptions = {}): GithubClient {
  const debugStr = getInput('debug', 'false').toLowerCase()
  return getOctokit(token, {
    debug: debugStr === 'true' || debugStr === '1',
    ...opts
  })
}

class Github {
  #organization = ''
  #repoOwner = ''
  #repoName = ''
  #client: GithubClient

  constructor(repoToken: string, opts?: OctokitOptions) {
    this.#client = buildOctokit(repoToken, opts)
  }

  static fromEnv(opts?: OctokitOptions): Github {
    return new Github(getInput('repo_token'), opts)
  }

  setOrg(organization: string, repoOwner: string, repoName: string): this {
    this.#organization = organization
    this.#repoOwner = repoOwner
    this.#repoName = repoName
    return this
  }

  isPREvent(event: GithubPRCommentMinimal): boolean {
    return event.issue && event.issue.pull_request ? true : false
  }

  async getMatchingTeams(username: string, inputTeams: string[] | string): Promise<string[]> {
    const query = `query($cursor: String, $org: String!, $userLogins: [String!], $username: String!)  {
      user(login: $username) {
          id
      }
      organization(login: $org) {
        teams (first:20, userLogins: $userLogins, after: $cursor) {
          nodes {
            name
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
  }`

    let data: MatchingTeamsResponse
    let cursor = null
    let teams: string[] = []
    do {
      data = await this.#client.graphql<MatchingTeamsResponse>(query, {
        cursor,
        org: this.#organization,
        userLogins: [username],
        username
      })

      console.log(`GetMatchingTeams Output: ${JSON.stringify(data, null, 2)}`)

      teams = teams.concat(
        data.organization.teams.nodes.map((val: { name: string }) => {
          return val.name
        })
      )

      cursor = data.organization.teams.pageInfo.endCursor
    } while (data.organization.teams.pageInfo.hasNextPage)

    if (typeof inputTeams === 'string') {
      inputTeams = inputTeams.split(',')
    }
    const teamsFound = teams.filter(teamName => inputTeams.includes(teamName.toLowerCase()))
    core.debug(`Teams found for user ${username}: ${teamsFound}`)
    return teamsFound
  }

  getPRFromEnv(): PullRequestGetResponse | undefined {
    try {
      // available from action.yml step
      if (process.env.PR_DETAILS) {
        const response = JSON.parse(process.env.PR_DETAILS) as PullRequestGetResponse
        core.debug(`Response from EnvVar: ${response}`)
        return response
      }
    } catch (ex) {
      // eslint-disable-next-line no-empty
    }
  }

  #validateAPIResponse<T>(errMsg: string, response: OctokitResponse<T>): T {
    if (!response) {
      throw new Error(errMsg)
    }
    return response.data
  }

  async getPRFromURL(prApiUrl: string): Promise<PullRequestGetResponse> {
    return (
      this.getPRFromEnv() ||
      this.#validateAPIResponse(
        'PR Not found',
        await this.#client.request(prApiUrl, {
          headers: {
            contentType: 'application/json',
            accept: 'application/vnd.github.v3+json'
          }
        })
      )
    )

    // await axios.get(prApiUrl, {
    //   headers: {
    //     Authorization: `Bearer ${this.#repoToken}`,
    //     'Content-Type': 'application/json',
    //     Accept: 'application/json'
    //   }
    // })
  }

  async getPullRequestApprovals(prNumber: number): Promise<PullRequestGetReviewList> {
    const reviewList = this.#validateAPIResponse(
      'PR Review List Error',
      await this.#client.rest.pulls.listReviews({
        owner: this.#repoOwner,
        repo: this.#repoName,
        pull_number: prNumber
      })
    )

    return reviewList.filter(review => review.state === 'APPROVED')
  }

  async getCodeOwners(): Promise<RepoGetCollaboratorListResponse> {
    const codeOwnerList = this.#validateAPIResponse(
      'Code owner List Error',
      await this.#client.rest.repos.listCollaborators({
        owner: this.#repoOwner,
        repo: this.#repoName
      })
    )
    return codeOwnerList
  }

  buildPRInfoFromPRResponse(prResponse: PullRequestGetResponse): PRInfo {
    return {
      author: prResponse.head.repo?.owner.login || '',
      baseBranch: prResponse.base.ref,
      isDraft: prResponse.draft || false,
      isOpen: prResponse.state.toLowerCase() === 'open',
      labels: prResponse.labels.map((label: PullRequestGetResponse['labels'][number]) => label.name),
      state: prResponse.state
    }
  }

  async getMinimalPRInfo(prNumber: number): Promise<MinimalPRInfo> {
    const query = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        state
        isDraft
        labels(first: 100) {
          nodes {
            name
          }
        }
        author {
          login
        }
        baseRefName
        reviews(first: 100, states: APPROVED) {
          nodes {
            author {
              login
            }
            body
            submittedAt
            commit {
              oid
            }
          }
        }
      }

      # expression: $prLastCommitOid
      # Format  "<sha>:.github/CODEOWNERS"
      object(expression: "HEAD:.github/CODEOWNERS") {
        ... on Blob {
          text
        }
      }
    }
  }
`
    return await this.#client.graphql<MinimalPRInfo>(query, {
      owner: this.#repoOwner,
      name: this.#repoName,
      number: prNumber
    })
  }

  async getPRInfoFromNumber(prNumber: number): Promise<PRInfo> {
    try {
      const response = this.getPRFromEnv()
      if (response) {
        return this.buildPRInfoFromPRResponse(response)
      }
    } catch (ex) {
      // eslint-disable-next-line no-empty
    }

    const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          state
          isDraft
          labels(first: 100) {
            nodes {
              name
            }
          }
          author {
            login
          }
          baseRefName
        }
      }
    }
  `

    const prResponse: {
      repository: {
        pullRequest: {
          author: {
            login: string
          }
          baseRefName: string
          isDraft: boolean
          state: string
          labels: {
            nodes: {
              name: string
            }[]
          }
        }
      }
    } = await this.#client.graphql(query, {
      owner: this.#repoOwner,
      name: this.#repoName,
      number: prNumber
    })

    const pr = prResponse.repository.pullRequest
    console.log(`PR Response from Number: ${prNumber}: `, pr)

    return {
      author: pr.author.login,
      baseBranch: pr.baseRefName,
      isDraft: pr.isDraft,
      isOpen: pr.state.toLowerCase() === 'open',
      labels: pr.labels.nodes.map((label: { name: string }) => label.name),
      state: pr.state
    }
  }

  async updateComment(commentId: number, message: string): Promise<IssueUpdateCommentResponse> {
    const response = await this.#client.rest.issues.updateComment({
      owner: this.#repoOwner,
      repo: this.#repoName,
      comment_id: commentId,
      body: message
    })

    return response.data
  }

  async addComment(message: string, prNumber: number): Promise<IssueCreateCommentResponse> {
    const response = await this.#client.rest.issues.createComment({
      owner: this.#repoOwner,
      repo: this.#repoName,
      issue_number: prNumber,
      body: message
    })
    return response.data
  }

  async addLabel(prNumber: number, label: string): Promise<void> {
    const existingLabels = JSON.parse(getEnv('PR_LABELS') || '[]').map((labelObj: { name: string }) => labelObj.name)
    if (existingLabels.includes(label)) {
      core.debug(`PR already has label ${label}`)
      return
    }

    // Add the label to the PR
    await this.#client.rest.issues.addLabels({
      owner: this.#repoOwner,
      repo: this.#repoName,
      issue_number: prNumber,
      labels: [label]
    })
  }
}

export default Github
