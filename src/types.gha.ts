type EventPayload = PullRequestPayload | PullRequestReviewPayload
export type EventName = EventNamePullRequest | EventNamePullRequestReview | EventNamePullRequestComment

type EventNamePullRequestReview = 'pull_request_review'
type EventNamePullRequest = 'pull_request'
type EventNamePullRequestComment = 'issue_comment'

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

interface PullRequestReviewPayload {
  action: 'submitted'
  organization: Organization
  pull_request: PullRequest
  repository: Repository
  review: Review
  sender: User
}

interface PullRequestPayload {
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

interface Comment {
  /**
   * Comment body
   */
  body: string
  created_at: string
  html_url: string
  id: number
  user: User
}

interface PullRequestCommentPayload {
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

export type ContextPullRequestReview = GithubContext<PullRequestReviewPayload, EventNamePullRequestReview>

export type ContextPullRequest = GithubContext<PullRequestPayload, EventNamePullRequest>

export type ContextPullRequestComment = GithubContext<PullRequestCommentPayload, EventNamePullRequestComment>

export type Context = ContextPullRequest | ContextPullRequestReview | ContextPullRequestComment
