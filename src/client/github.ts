import { getOctokit } from '@actions/github'
import * as core from '@actions/core'
import { getInput } from '../util'
// eslint-disable-next-line import/no-unresolved
import { OctokitOptions } from '@octokit/core/dist-types/types'
// eslint-disable-next-line import/named
import { RestEndpointMethodTypes } from '@octokit/rest'
// eslint-disable-next-line import/no-unresolved
import { OctokitResponse } from '@octokit/types'

type GithubClient = ReturnType<typeof getOctokit> // InstanceType<typeof GitHub>

export type IssueCreateCommentResponse = RestEndpointMethodTypes['issues']['createComment']['response']['data']
export type IssueUpdateCommentResponse = RestEndpointMethodTypes['issues']['updateComment']['response']['data']
type IssueAddLabelResponse = RestEndpointMethodTypes['issues']['addLabels']['response']['data']
type GetUserForTeamsResponse = Record<string, string[]>

function buildOctokit(token: string, opts: OctokitOptions = {}): GithubClient {
  const debugStr = getInput('debug', 'false').toLowerCase()
  return getOctokit(token, {
    debug: debugStr === 'true' || debugStr === '1',
    ...opts
  })
}

class Client {
  #organization = ''
  #repoOwner = ''
  #repoName = ''
  #client: GithubClient

  constructor(repoToken: string, opts?: OctokitOptions) {
    this.#client = buildOctokit(repoToken, opts)
  }

  static fromEnv(opts?: OctokitOptions): Client {
    return new Client(getInput('repo_token'), opts)
  }

  setOrg(organization: string, repoOwner: string, repoName: string): this {
    this.#organization = organization
    this.#repoOwner = repoOwner
    this.#repoName = repoName
    return this
  }

  async getUserForTeams(teams: string[], fetchCount: number): Promise<GetUserForTeamsResponse> {
    const buildTeamNode = (id: number): string => `team${id}: team(slug: $team${id}) {
      name
      members(first: $fetchCount) {
        nodes {
          login
        }
      }
    }
    `

    const builder: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: { fetchCount: number; orgLogin: string; [key: string]: any }
      teamQuery: string
      headQuery: string
    } = {
      params: {
        fetchCount,
        orgLogin: this.#organization
      },
      teamQuery: '',
      headQuery: 'query($orgLogin: String!, $fetchCount: Int!'
    }

    const { params, teamQuery, headQuery } = teams.reduce((acc, teamName, idx) => {
      acc.teamQuery += buildTeamNode(idx)
      acc.params[`team${idx}`] = teamName
      acc.headQuery += `, $team${idx}: String!`
      return acc
    }, builder)

    const query = `${headQuery}) {
  organization(login: $orgLogin) {
    ${teamQuery}
  }
}
`
    const result: {
      organization: Record<string, { members: { nodes: { login: string }[] } }>
    } = await this.#client.graphql(query, params)

    return teams.reduce<GetUserForTeamsResponse>((acc, teamName, idx) => {
      const teamObj = result.organization[`team${idx}`]
      if (teamObj) {
        acc[teamName] = teamObj.members.nodes.map(member => member.login)
      } else {
        acc[teamName] = []
      }
      return acc
    }, {})
  }

  #validateAPIResponse<T>(errMsg: string, response: OctokitResponse<T>): T {
    // console.debug(response)
    if (!response) {
      console.error(response)
      throw new Error(errMsg)
    }
    return response.data
  }

  /**
   * Get list of users who have approved the PR
   *
   * @param prNumber
   * @returns
   */
  async getPullRequestApprovedUserList(prNumber: number): Promise<string[]> {
    const query = `query($owner: String!, $repoName: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repoName) {
    pullRequest(number: $prNumber) {
      reviews(first: 20, states: APPROVED) {
        nodes {
          author {
            login
          }
        }
      }
    }
  }
}`
    const response: {
      repository: { pullRequest: { reviews: { nodes: { author: { login: string } }[] } } }
    } = await this.#client.graphql(query, {
      owner: this.#repoOwner,
      repoName: this.#repoName,
      prNumber
    })

    const userSet = response.repository.pullRequest.reviews.nodes.reduce(
      (acc, review: { author: { login: string } }) => {
        acc.add(review.author.login)
        return acc
      },
      new Set<string>()
    )
    return [...userSet]
  }

  async addComment(prNumber: number, message: string): Promise<IssueCreateCommentResponse> {
    core.debug(`Adding github comment=${message}`)
    return this.#validateAPIResponse(
      'Add comment',
      await this.#client.rest.issues.createComment({
        owner: this.#repoOwner,
        repo: this.#repoName,
        issue_number: prNumber,
        body: message
      })
    )
  }

  async updateComment(commentId: number, message: string): Promise<IssueUpdateCommentResponse> {
    core.debug(`Updating github comment ${commentId}\nMsg=${message}`)
    return this.#validateAPIResponse(
      'Add comment',
      await this.#client.rest.issues.updateComment({
        owner: this.#repoOwner,
        repo: this.#repoName,
        comment_id: commentId,
        body: message
      })
    )
  }

  async addLabel(prNumber: number, labels: string[]): Promise<IssueAddLabelResponse> {
    return this.#validateAPIResponse(
      'Add Label',
      await this.#client.rest.issues.addLabels({
        owner: this.#repoOwner,
        repo: this.#repoName,
        issue_number: prNumber,
        labels
      })
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPRInformation(prNumber: number): Promise<any> {
    const pr = this.#validateAPIResponse(
      'Get PR Information',
      await this.#client.rest.pulls.get({
        owner: this.#repoOwner,
        repo: this.#repoName,
        pull_number: prNumber
      })
    )
    return {
      defaultBranchRef: {
        name: pr.base.repo.default_branch
      },
      pullRequest: {
        baseRef: {
          name: pr.base.ref,
          repository: {
            id: pr.base.repo.id,
            name: pr.base.repo.name,
            url: pr.base.repo.html_url,
            primaryLanguage: {
              name: pr.base.repo.language
            },
            owner: {
              login: pr.base.repo.owner.login
            }
          }
        }
      }
    }
  }

  async getChangedFiles(prNumber: number): Promise<string[]> {
    const response = this.#validateAPIResponse(
      'Get Changed Files',
      await this.#client.rest.pulls.listFiles({
        owner: this.#repoOwner,
        repo: this.#repoName,
        pull_number: prNumber
      })
    )
    return response.map(file => file.filename)
  }
}

export default Client
