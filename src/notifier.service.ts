import * as core from '@actions/core'
import { TextBuilder } from './formatting/text-builder'
import { getDirectoryForDb } from './migration/migration'
import {
  Config,
  DriftParams,
  DriftResponse,
  GithubNotifyResponse,
  ITextBuilder,
  Notifier,
  NotifyParams,
  NotifyResponse
} from './types'
import * as gha from './types.gha'
import { JiraClient, JiraComment, JiraIssue } from './types.jira'
import { formatterMap } from './formatting/formatters'

export class NotifierService implements Notifier {
  #dryRun: boolean
  #config: Config
  #ghClient: gha.GHClient
  #jiraClient: JiraClient | null

  constructor(dryRun: boolean, config: Config, ghClient: gha.GHClient, jiraClient: JiraClient | null) {
    this.#dryRun = dryRun
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
      ghCommentPromise = this.#ghClient.closePR(params.pr.number, githubSummaryText)
    } else if ('commentId' in params.migrationMeta) {
      ghCommentPromise = this.#ghClient.updateComment(
        params.migrationMeta.commentId,
        `${params.migrationMeta.commentBody}\r\n\r\n${githubSummaryText}`
      )
    } else {
      let jiraTicket = ''
      if (params.jiraIssue) {
        jiraTicket = `\r\nJIRA Ticket: ${params.jiraIssue.key}`
      }

      ghCommentPromise = this.#ghClient.addComment(
        params.pr.number,
        `Executed By: ${formatterMap.github.userRef(params.migrationMeta.triggeredBy.login)}\r\nReason: ${
          params.migrationMeta.eventName
        }.${params.migrationMeta.actionName}${jiraTicket}\r\n${githubSummaryText}`
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
        params.migrationMeta.ensureJiraTicket &&
        params.migrationRunListResponse.migrationAvailable &&
        (!params.migrationRunListResponse.errMsg || params.jiraIssue)
      )

    core.debug(`Can create JIRA Issue or Command: ${canIntegrateWithJira ? 'Yes' : 'No'}`)

    if (!canIntegrateWithJira || !this.#jiraClient) {
      return [Promise.resolve(undefined), Promise.resolve(undefined)]
    }

    if (jiraIssue === undefined) {
      jiraIssue = await this.#jiraClient.findIssue(params.pr.html_url)
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
        description: builder.description(issueComment),
        prLink: params.pr.html_url,
        repoLink: params.pr.base.repo.html_url,
        prNumber: params.pr.number
      })
    }

    return [jiraIssuePromise, jiraCommentPromise]
  }

  async notify(params: NotifyParams): Promise<NotifyResponse> {
    const builder = new TextBuilder(
      this.#dryRun,
      params.pr.html_url,
      params.pr.base.repo.html_url,
      this.#config.databases.map(db => getDirectoryForDb(this.#config.baseDirectory, db))
    )

    const [jiraIssuePromise, jiraCommentPromise] = await this.buildJiraComment(builder.platform.jira, params)
    const [jiraIssue, jiraComment] = await Promise.all([jiraIssuePromise, jiraCommentPromise])

    params.jiraIssue = jiraIssue

    const ghCommentPromise = this.buildGithubComment(builder.platform.github, params)

    const response = await Promise.allSettled([ghCommentPromise, core.summary.write()])

    if (response[0].status === 'rejected') {
      core.error('GHCommentError: ', response[0].reason)
      throw response[0].reason
    }

    return {
      githubComment: response[0].value,
      jiraIssue: params.jiraIssue,
      jiraComment
    }
  }

  async buildDriftJiraComment(
    builder: ITextBuilder,
    params: DriftParams
  ): Promise<[JiraIssue | undefined, JiraComment | undefined]> {
    const jiraIssue = params.jiraIssue

    if (jiraIssue === undefined) {
      return Promise.resolve([undefined, undefined])
    }

    const jiraDescription = builder.drift(params.driftRunListResponse)

    if (!this.#jiraClient) {
      return Promise.resolve([undefined, undefined])
    }
    // If we already have a JIRA ticket for drift with the same description.
    // depicts no action was taken by service team b/w multiple invocation of this action.
    if (jiraIssue !== null && jiraIssue.fields.description === jiraDescription) {
      core.debug('Current JIRA ticket has same drift')
      return Promise.resolve([jiraIssue || undefined, undefined])
    }

    let jiraIssuePromise: Promise<JiraIssue | undefined>
    let jiraCommentPromise: Promise<JiraComment | undefined>

    if (jiraIssue) {
      jiraIssuePromise = Promise.resolve(jiraIssue)
      jiraCommentPromise = this.#jiraClient.addComment(jiraIssue.id, jiraDescription)
    } else {
      jiraIssuePromise = this.#jiraClient.createIssue({
        description: jiraDescription,
        repoLink: params.repo.html_url,
        isSchemaDrift: true
      })
      jiraCommentPromise = Promise.resolve(undefined)
    }

    return [await jiraIssuePromise, await jiraCommentPromise]
  }

  buildDriftGithubComment(builder: ITextBuilder, params: DriftParams): void {
    let summary = builder.drift(params.driftRunListResponse)
    if (params.jiraIssue) {
      summary = summary = `JIRA Ticket: ${params.jiraIssue.key}\r\n${summary}`
    }

    core.summary.addRaw(summary)
  }

  async drift(params: DriftParams): Promise<DriftResponse> {
    const builder = new TextBuilder(
      this.#dryRun,
      '',
      params.repo.html_url,
      this.#config.databases.map(db => getDirectoryForDb(this.#config.baseDirectory, db))
    )

    const [jiraIssue, jiraComment] = await this.buildDriftJiraComment(builder.platform.jira, params)
    params.jiraIssue = jiraIssue

    this.buildDriftGithubComment(builder.platform.github, params)

    await core.summary.write()

    return {
      jiraIssue,
      jiraComment
    }
  }
}
