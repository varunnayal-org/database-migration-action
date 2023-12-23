import * as core from '@actions/core'
import GHClient from './client/github'
import JiraClient, { JiraComment, JiraIssue } from './client/jira'
import { Config } from './config'
import { TextBuilder } from './formatting/text-builder'
import { getDirectoryForDb } from './migration/migration'
import { GithubNotifyResponse, ITextBuilder, MigrationMeta, NotifyParams, NotifyResponse } from './types'
import * as gha from './types.gha'
import { formatterMap } from './formatting/formatters'

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

  #buildSummary(builder: ITextBuilder, params: NotifyParams): string {
    let summaryText = ''
    if (params.changedFileValidation?.errMsg) {
      summaryText = `**Changed File Validation Error**: ${params.changedFileValidation.errMsg}
Unmatched Files:
- ${params.changedFileValidation.unmatched.map(f => f).join('\r\n- ')}
`
    } else if (params.lintResponseList && params.lintResponseList.errMsg) {
      summaryText = builder.lint(params.lintResponseList.lintResponseList)
      if (params.addMigrationRunResponseForLint) {
        summaryText = `${summaryText}\r\n\r\n${builder.run(params.migrationRunListResponse)}`
      }
    } else {
      summaryText = builder.run(params.migrationRunListResponse)
    }

    return summaryText
  }

  async buildGithubComment(builder: ITextBuilder, params: NotifyParams): Promise<GithubNotifyResponse> {
    const githubSummaryText = this.#buildSummary(builder, params)
    core.summary.addRaw(githubSummaryText)

    let ghCommentPromise: Promise<GithubNotifyResponse>
    if (params.closePR === true) {
      ghCommentPromise = this.#ghClient.closePR(this.#pr.number, githubSummaryText)
    } else if ('commentId' in this.#migrationMeta) {
      ghCommentPromise = this.#ghClient.updateComment(
        this.#migrationMeta.commentId,
        `${this.#migrationMeta.commentBody}\r\n\r\n${githubSummaryText}`
      )
    } else {
      ghCommentPromise = this.#ghClient.addComment(
        this.#pr.number,
        `Executed By: ${formatterMap.github.userRef(this.#migrationMeta.triggeredBy.login)}\r\nReason=${
          this.#migrationMeta.eventName
        }.${this.#migrationMeta.actionName}\r\n${githubSummaryText}`
      )
    }
    return ghCommentPromise
  }

  async buildJiraComment(
    builder: ITextBuilder,
    params: NotifyParams
  ): Promise<[Promise<JiraIssue | undefined>, Promise<JiraComment | undefined>]> {
    let jiraIssue = params.jiraIssue

    /**
     * We will have JIRA integration iff
     * - We are applying migration instead of dry running it
     * - OR
     * - - We don't have any changed file validation error AND
     * - - Caller has explicitly asked for JIRA integration(pull_request event) AND
     * - - Migration is available AND
     * - - AND
     * - - - There is no error message while running dry running migration OR
     * - - - JIRA issue is already present
     */
    const canIntegrateWithJira =
      this.#dryRun === false ||
      !!(
        !params.changedFileValidation &&
        this.#migrationMeta.ensureJiraTicket &&
        params.migrationRunListResponse.migrationAvailable &&
        (!params.migrationRunListResponse.errMsg || params.jiraIssue)
      )

    core.debug(`Can create JIRA Issue or Command: ${canIntegrateWithJira ? 'Yes' : 'No'}`)

    if (!canIntegrateWithJira || !this.#jiraClient) {
      return [Promise.resolve(undefined), Promise.resolve(undefined)]
    }

    if (jiraIssue === undefined) {
      jiraIssue = await this.#jiraClient.findIssue(this.#pr.html_url)
    }

    const issueComment = this.#buildSummary(builder, params)

    let jiraIssuePromise: Promise<JiraIssue | undefined> = Promise.resolve(undefined)
    let jiraCommentPromise: Promise<JiraComment | undefined> = Promise.resolve(undefined)
    // Add issue or comment
    if (jiraIssue) {
      jiraCommentPromise = this.#jiraClient.addComment(jiraIssue.id, issueComment)
      jiraIssuePromise = Promise.resolve(jiraIssue)
    } else {
      jiraIssuePromise = this.#jiraClient.createIssue({
        title: builder.title(this.#config.serviceName),
        description: builder.description(issueComment),
        prLink: this.#pr.html_url,
        repoLink: this.#pr.base.repo.html_url,
        prNumber: this.#pr.number
      })
    }

    return [jiraIssuePromise, jiraCommentPromise]
  }

  async notify(params: NotifyParams): Promise<NotifyResponse> {
    const builder = new TextBuilder(
      this.#dryRun,
      this.#pr.html_url,
      this.#pr.base.repo.html_url,
      this.#config.databases.map(db => getDirectoryForDb(this.#config.baseDirectory, db))
    )

    const ghCommentPromise = this.buildGithubComment(builder.platform.github, params)
    const [jiraIssuePromise, jiraCommentPromise] = await this.buildJiraComment(builder.platform.jira, params)

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
