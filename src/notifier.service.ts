import * as core from '@actions/core'
import GHClient, { IssueCreateCommentResponse, IssueUpdateCommentResponse } from './client/github'
import JiraClient, { JiraComment, JiraIssue } from './client/jira'
import { Config } from './config'
import { TextBuilder } from './formatting/text-builder'
import { getDirectoryForDb } from './migration/migration'
import { MigrationLintResponse, MigrationMeta, MigrationRunListResponse } from './types'
import * as gha from './types.gha'

export type NotifyResponse = {
  githubComment: IssueCreateCommentResponse | IssueUpdateCommentResponse
  jiraIssue?: JiraIssue
  jiraComment?: JiraComment
}

export class NotifierService {
  #dryRun: boolean
  #pr: gha.PullRequest
  #migrationMeta: MigrationMeta
  #config: Config
  #ghClient: GHClient
  #jiraClient: JiraClient | null

  constructor(
    dryRun: boolean,
    pr: gha.PullRequest,
    migrationMeta: MigrationMeta,
    config: Config,
    ghClient: GHClient,
    jiraClient: JiraClient | null
  ) {
    this.#dryRun = dryRun
    this.#pr = pr
    this.#migrationMeta = migrationMeta
    this.#config = config
    this.#ghClient = ghClient
    this.#jiraClient = jiraClient
  }

  async buildGithubComment(
    builder: TextBuilder,
    migrationRunListResponse: MigrationRunListResponse,
    lintResponseList?: MigrationLintResponse
  ): Promise<IssueUpdateCommentResponse | IssueCreateCommentResponse> {
    let githubSummaryText: string = ''
    if (lintResponseList && lintResponseList.errMsg) {
      githubSummaryText = builder.githubLint(lintResponseList.lintResponseList)
    } else {
      githubSummaryText = builder.github(migrationRunListResponse)
    }

    core.summary.addRaw(githubSummaryText)

    let ghCommentPromise: Promise<IssueUpdateCommentResponse | IssueCreateCommentResponse>
    if ('commentId' in this.#migrationMeta) {
      ghCommentPromise = this.#ghClient.updateComment(
        this.#migrationMeta.commentId,
        `${this.#migrationMeta.commentBody}\r\n\r\n${githubSummaryText}`
      )
    } else {
      ghCommentPromise = this.#ghClient.addComment(
        this.#pr.number,
        `Executed By: ${builder.getFormatter('github').userRef(this.#migrationMeta.triggeredBy.login)}\r\nReason=${
          this.#migrationMeta.eventName
        }.${this.#migrationMeta.actionName}\r\n${githubSummaryText}`
      )
    }
    return ghCommentPromise
  }

  async buildJiraComment(
    builder: TextBuilder,
    migrationRunListResponse: MigrationRunListResponse,
    lintResponseList?: MigrationLintResponse,
    jiraIssue?: JiraIssue | null | undefined
  ): Promise<[Promise<JiraIssue | undefined>, Promise<JiraComment | undefined>]> {
    let jiraIssuePromise: Promise<JiraIssue | undefined> = Promise.resolve(undefined)
    let jiraCommentPromise: Promise<JiraComment | undefined> = Promise.resolve(undefined)

    const canIntegrateWithJira =
      // if applying migration
      this.#dryRun === false ||
      // else for dry run
      // if a pr event (open, reopen, sync)
      !!(
        this.#migrationMeta.ensureJiraTicket &&
        // migration should be available
        migrationRunListResponse.migrationAvailable &&
        // no error message should exists
        (!migrationRunListResponse.errMsg || jiraIssue)
      )

    core.debug(`Can create JIRA Issue or Command: ${canIntegrateWithJira ? 'Yes' : 'No'}`)

    if (!canIntegrateWithJira || !this.#jiraClient) {
      return [jiraIssuePromise, jiraCommentPromise]
    }

    if (jiraIssue === undefined) {
      jiraIssue = await this.#jiraClient.findIssue(this.#pr.html_url)
    }

    let issueComment: string = ''
    if (lintResponseList && lintResponseList.errMsg) {
      issueComment = builder.jiraLint(lintResponseList.lintResponseList)
    } else {
      issueComment = builder.jira(migrationRunListResponse)
    }

    // Add issue or comment
    if (jiraIssue) {
      jiraCommentPromise = this.#jiraClient.addComment(jiraIssue.id, issueComment)
      jiraIssuePromise = Promise.resolve(jiraIssue)
    } else {
      jiraIssuePromise = this.#jiraClient.createIssue({
        title: builder.jiraTitle(this.#config.serviceName),
        description: builder.jiraDescription(issueComment),
        prLink: this.#pr.html_url,
        repoLink: this.#pr.base.repo.html_url,
        prNumber: this.#pr.number
      })
    }

    return [jiraIssuePromise, jiraCommentPromise]
  }

  async notify(
    migrationRunListResponse: MigrationRunListResponse,
    lintResponseList?: MigrationLintResponse,
    jiraIssue?: JiraIssue | null | undefined
  ): Promise<NotifyResponse> {
    const builder = new TextBuilder(
      this.#dryRun,
      this.#pr.html_url,
      this.#pr.base.repo.html_url,
      this.#config.databases.map(db => getDirectoryForDb(this.#config.baseDirectory, db))
    )

    const ghCommentPromise = this.buildGithubComment(builder, migrationRunListResponse, lintResponseList)
    const [jiraIssuePromise, jiraCommentPromise] = await this.buildJiraComment(
      builder,
      migrationRunListResponse,
      lintResponseList,
      jiraIssue
    )

    const response = await Promise.allSettled([
      ghCommentPromise,
      jiraIssuePromise,
      jiraCommentPromise,
      core.summary.write()
    ])

    if (response[0].status === 'rejected') {
      core.error('GHCommentError: ', response[0].reason)
      throw response[0].reason
    }
    if (response[1].status === 'rejected') {
      core.error('JiraIssueError: ', response[1].reason)
      throw response[1].reason
    }
    if (response[2].status === 'rejected') {
      core.error('JiraCommentError: ', response[2].reason)
      throw response[2].reason
    }

    return {
      githubComment: response[0].value,
      jiraIssue: response[1].value,
      jiraComment: response[2].value
    }
  }
}
