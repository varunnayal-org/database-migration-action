import * as github from '@actions/github'

// eslint-disable-next-line import/named
import { RestEndpointMethodTypes } from '@octokit/rest'

type EventPayload = PullRequestPayload | PullRequestReviewPayload
export type EventName = EventNamePullRequest | EventNamePullRequestReview | EventNamePullRequestComment

type EventNamePullRequestReview = 'pull_request_review'
type EventNamePullRequest = 'pull_request'
type EventNamePullRequestComment = 'issue_comment'
type EventNameSchedule = 'schedule'

/**
 * The context for the event that triggered the workflow.
 * ```ts
 * import github from '@action/github'
 *
 * const context: GithubContext = github.context
 * ```
 */
interface GithubContext<T = EventPayload, E = EventName> {
  payload: T
  eventName: E
  sha: string
  ref: string
  workflow: string
  runNumber: number
  runId: number
}

interface Organization {
  login: string
}

export interface PullRequest {
  assignee: User | null
  assignees: User[]
  created_at: string

  /**
   * The branch (or git ref) that the pull request is merging into. Also known as the base branch.
   */
  base: Branch

  /**
   * Indicates whether or not the pull request is a draft.
   */
  draft: boolean

  html_url: string
  id: number
  labels: Label[]
  number: number
  state: string
  title: string
  updated_at: string
  user: User
}

export interface Branch {
  ref: string
  repo: Repository
}

export interface Repository {
  default_branch: string
  html_url: string
  language: string
  name: string
  owner: Organization
}

export interface User {
  login: string
  type: string
}

export interface Label {
  id: number
  name: string
}

export interface Review {
  commit_id: string
  html_url: string
  id: number
  submitted_at: string
  user: User
}

export interface PullRequestReviewPayload {
  action: 'submitted'
  organization: Organization
  pull_request: PullRequest
  repository: Repository
  review: Review
  sender: User
}

export interface PullRequestPayload {
  action: 'opened' | 'reopened' | 'synchronize'

  /**
   * The SHA of the most recent commit on ref after the push.
   * Available when action='synchronize'
   */
  after: string | undefined
  /**
   * The SHA of the most recent commit on ref before the push.
   * Available when action='synchronize'
   */
  before: string | undefined

  number: number
  organization: Organization
  pull_request: PullRequest
  repository: Repository
  sender: User
}

export interface Comment {
  /**
   * Comment body
   */
  body: string
  created_at: string
  html_url: string
  id: number
  user: User
}

export interface PullRequestCommentPayload {
  action: 'created'
  comment: Comment

  /**
   * PullRequestIssue does not have **base** and **head** properties
   * **base** is something we'll build using the incoming issue_comment payload.
   * If head is required, then we might need to call gh APIs to build it
   */
  issue: PullRequest
  organization: Organization
  repository: Repository
  sender: User
}

export interface SchedulePayload {
  schedule: string
  organization: Organization
  repository: Repository
}

export type ContextPullRequestReview = GithubContext<PullRequestReviewPayload, EventNamePullRequestReview>

export type ContextPullRequest = GithubContext<PullRequestPayload, EventNamePullRequest>

export type ContextPullRequestComment = GithubContext<PullRequestCommentPayload, EventNamePullRequestComment>

export type ContextSchedule = GithubContext<SchedulePayload, EventNameSchedule>

export type Context = ContextSchedule | ContextPullRequest | ContextPullRequestReview | ContextPullRequestComment

export type GithubClient = ReturnType<typeof github.getOctokit> // InstanceType<typeof GitHub>

/**
 * `IssueCreateCommentResponse` is a type that represents the response data from the `createComment` method of the `issues` endpoint in the GitHub REST API.
 */
export type IssueCreateCommentResponse = RestEndpointMethodTypes['issues']['createComment']['response']['data']

/**
 * `IssueUpdateCommentResponse` is a type that represents the response data from the `updateComment` method of the `issues` endpoint in the GitHub REST API.
 */
export type IssueUpdateCommentResponse = RestEndpointMethodTypes['issues']['updateComment']['response']['data']

/**
 * `PullRequestUpdateResponse` is a type that represents the response data from the `update` method of the `pulls` endpoint in the GitHub REST API.
 */
export type PullRequestUpdateResponse = RestEndpointMethodTypes['pulls']['update']['response']['data']

/**
 * `IssueAddLabelResponse` is a type that represents the response data from the `addLabels` method of the `issues` endpoint in the GitHub REST API.
 */
export type IssueAddLabelResponse = RestEndpointMethodTypes['issues']['addLabels']['response']['data']

/**
 * `GetUserForTeamsResponse` is a type that represents a record where the keys are strings and the values are arrays of strings. It can be used to map team names to arrays of user names.
 */
export type GetUserForTeamsResponse = Record<string, string[]>

/**
 * `GHClient` is an interface that represents a client for interacting with GitHub.
 */
export interface GHClient {
  /**
   * `setOrg` is a method in the `GHClient` interface.
   *
   * @param org - A string representing the name of the GitHub organization.
   * @param repoOwner - A string representing the username of the repository owner.
   * @param repoName - A string representing the name of the repository.
   *
   * This method sets the organization, repository owner, and repository name for the client. These values are used in subsequent calls to the GitHub API.
   */
  setOrg(org: string, repoOwner: string, repoName: string): void
  /**
   * `getUserForTeams` is a method in the `GHClient` interface.
   *
   * @param teams - An array of team names as strings. This method fetches users for these specified teams.
   * @param fetchCount - A number that determines the maximum number of users to fetch for each team.
   *
   * @returns A promise that resolves to a `GetUserForTeamsResponse`. This is a record where the keys are team names and the values are arrays of user names. For each team in the `teams` parameter, there will be a key-value pair in the response where the key is the team name and the value is an array of user names.
   */
  getUserForTeams(teams: string[], fetchCount: number): Promise<GetUserForTeamsResponse>

  /**
   * `getChangedFiles` is a method in the `GHClient` interface.
   *
   * @param prNumber - A number representing the pull request number.
   *
   * @returns A promise that resolves to an array of strings. Each string in the array represents the name of a file that was changed in the specified pull request.
   *
   * This method is used to fetch the list of files that were changed in the specified pull request on GitHub.
   */
  getChangedFiles(prNumber: number): Promise<string[]>

  /**
   * `getPRInformation` is a method in the `GHClient` interface.
   *
   * @param prNumber - A number representing the pull request number.
   *
   * @returns A promise that resolves to any type. The resolved value represents the information about the specified pull request.
   *
   * This method is used to fetch information about the specified pull request on GitHub.
   */
  getPRInformation(prNumber: number): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * `getPullRequestApprovedUserList` is a method in the `GHClient` interface.
   *
   * @param prNumber - A number representing the pull request number.
   *
   * @returns A promise that resolves to an array of strings. Each string in the array represents the username of a user who has approved the specified pull request.
   *
   * This method is used to fetch the list of users who have approved the specified pull request on GitHub.
   */
  getPullRequestApprovedUserList(prNumber: number): Promise<string[]>

  /**
   * `addLabel` is a method in the `GHClient` interface.
   *
   * @param prNumber - A number representing the pull request number.
   * @param labels - An array of strings representing the labels to be added.
   *
   * @returns A promise that resolves to an `IssueAddLabelResponse`. This represents the response data from the `addLabels` method of the `issues` endpoint in the GitHub REST API.
   *
   * This method is used to add the specified labels to the specified pull request on GitHub.
   */
  addLabel(prNumber: number, labels: string[]): Promise<IssueAddLabelResponse>

  /**
   * `closePR` is a method in the `GHClient` interface.
   *
   * @param prNumber - A number representing the pull request number.
   * @param body - A string representing the body text to be included when closing the pull request.
   *
   * @returns A promise that resolves to a `PullRequestUpdateResponse`. This represents the response data from the `update` method of the `pulls` endpoint in the GitHub REST API.
   *
   * This method is used to close the specified pull request on GitHub and include the specified body text.
   */
  closePR(prNumber: number, body: string): Promise<PullRequestUpdateResponse>

  /**
   * `updateComment` is a method in the `GHClient` interface.
   *
   * @param commentId - A number representing the ID of the comment to be updated.
   * @param comment - A string representing the new comment text.
   *
   * @returns A promise that resolves to an `IssueUpdateCommentResponse`. This represents the response data from the `updateComment` method of the `issues` endpoint in the GitHub REST API.
   *
   * This method is used to update the text of a specified comment on GitHub.
   */
  updateComment(commentId: number, comment: string): Promise<IssueUpdateCommentResponse>
  /**
   * `addComment` is a method in the `GHClient` interface.
   *
   * @param prNumber - A number representing the pull request number.
   * @param comment - A string representing the comment to be added.
   *
   * @returns A promise that resolves to an `IssueCreateCommentResponse`. This represents the response data from the `createComment` method of the `issues` endpoint in the GitHub REST API.
   *
   * This method is used to add a comment to the specified pull request on GitHub.
   */
  addComment(prNumber: number, comment: string): Promise<IssueCreateCommentResponse>
}
