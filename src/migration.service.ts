import * as core from '@actions/core'
import GHClient, { IssueCreateCommentResponse, IssueUpdateCommentResponse } from './client/github'
import AWSClient from './client/aws'
import { Config } from './config'
import * as gha from './types.gha'
import { runMigrationFromList, buildMigrationConfigList, getDirectoryForDb } from './migration'
import {
  MigrationRunListResponse,
  MatchTeamWithPRApproverResult,
  RunMigrationResult,
  MigrationMeta,
  MigrationResponse
} from './types'
import { commentBuilder, getFileListingForComment } from './util'

export default class MigrationService {
  #client: GHClient
  #aws: AWSClient
  #config: Config

  constructor(config: Config, client: GHClient, awsClient: AWSClient) {
    this.#config = config
    this.#client = client
    this.#aws = awsClient
  }

  #validatePullRequest(pullRequest: gha.PullRequest): string | undefined {
    const { base } = pullRequest
    if (base.ref !== this.#config.baseBranch) {
      return `Base branch should be ${this.#config.baseBranch}, found ${base.ref}`
    } else if (pullRequest.state !== 'open') {
      return `PR is in ${pullRequest.state} state`
    } else if (pullRequest.draft) {
      return 'PR is in draft state'
    }
  }

  #hasLabel(labels: gha.Label[], label: string): boolean {
    return labels.some(labelEntry => labelEntry.name === label)
  }

  async #ensureLabel(prNumber: number, labels: gha.Label[], label: string): Promise<void> {
    if (this.#hasLabel(labels, label)) {
      return
    }
    await this.#client.addLabel(prNumber, label)
  }

  /**
   * Add label if not present
   *
   * @param {gha.ContextPullRequest} event
   */
  async #processPullRequest(event: gha.ContextPullRequest): Promise<RunMigrationResult> {
    const { payload } = event
    const result = await this.#runMigrationForDryRun(payload.pull_request, {
      eventName: event.eventName,
      actionName: payload.action,
      source: 'pr',
      triggeredBy: payload.pull_request.user
    })

    if (result.migrationAvailable) {
      // We can create JIRA ticket if required
      await this.#ensureLabel(payload.number, payload.pull_request.labels, this.#config.prLabel)
    }
    return result
  }

  async #matchTeamWithPRApprovers(prApprovedByUserList: string[]): Promise<MatchTeamWithPRApproverResult> {
    // No need to call API when
    // - no approvals are required
    // - or, no one has approved the PR yet
    if (prApprovedByUserList.length === 0) {
      return this.#config.approvalTeams.reduce<MatchTeamWithPRApproverResult>(
        (acc, teamName) => {
          acc.prApprovedUserListByTeam[teamName] = []
          return acc
        },
        {
          teamByName: {},
          prApprovedUserListByTeam: {},
          approvalMissingFromTeam: this.#config.approvalTeams
        }
      )
    }

    const teamByName = await this.#client.getUserForTeams(this.#config.allTeams, 100)

    const result: MatchTeamWithPRApproverResult = {
      teamByName,
      prApprovedUserListByTeam: {},
      approvalMissingFromTeam: []
    }

    for (const teamName of this.#config.approvalTeams) {
      const filteredMember = prApprovedByUserList.filter(user => teamByName[teamName].includes(user))
      result.prApprovedUserListByTeam[teamName] = filteredMember
      if (filteredMember.length === 0) {
        result.approvalMissingFromTeam.push(teamName)
      }
    }

    return result
  }

  async #addCommentWithFileListing(
    pullRequest: gha.PullRequest,
    msg: string,
    executionResponseList: MigrationResponse[],
    migrationMeta: MigrationMeta
  ): Promise<IssueUpdateCommentResponse | IssueCreateCommentResponse> {
    const fileListForComment = getFileListingForComment(
      executionResponseList,
      this.#config.databases.map(db => getDirectoryForDb(this.#config.baseDirectory, db))
    )

    let commentId: number | undefined
    let commentBody: string | undefined

    if ('commentId' in migrationMeta) {
      commentId = migrationMeta.commentId
      commentBody = migrationMeta.commentBody
    }

    let commentHandler: (
      commentIdOrPrNumber: number,
      commentMsgToWrite: string
    ) => Promise<IssueUpdateCommentResponse | IssueCreateCommentResponse>
    let id = 0

    let commentMsg = `${msg}\r\n${fileListForComment}`
    core.summary.addRaw(commentMsg)
    if (commentBody && commentId) {
      commentHandler = this.#client.updateComment.bind(this.#client)
      id = commentId
      commentMsg = `${commentBody}\r\n\r\n${commentMsg}`
      core.debug(`Updating comment=${commentId}\nMsg=${commentMsg}`)
    } else {
      commentHandler = this.#client.addComment.bind(this.#client)
      id = pullRequest.number
      commentMsg = `Executed By: @${migrationMeta.triggeredBy.login}\r\nReason=${migrationMeta.eventName}.${migrationMeta.actionName}\r\n${commentMsg}`
      core.debug(`Adding comment ${commentMsg}`)
    }

    const response = await Promise.allSettled([core.summary.write(), commentHandler(id, commentMsg)])

    if (response[1].status === 'rejected') {
      throw response[1].reason
    }

    return response[1].value
  }

  async #handleDryRunResponse(
    pullRequest: gha.PullRequest,
    migrationRunListResponse: MigrationRunListResponse,
    commentBuilderFn: (boldText: string, msg?: string) => string,
    migrationMeta: MigrationMeta
  ): Promise<void> {
    let msg = ''
    if (migrationRunListResponse.errMsg !== null) {
      msg = commentBuilderFn('failed', migrationRunListResponse.errMsg)
    } else if (migrationRunListResponse.migrationAvailable === false) {
      msg = commentBuilderFn('failed', 'No migrations available')
    } else {
      msg = commentBuilderFn('successful')
    }
    await this.#addCommentWithFileListing(
      pullRequest,
      msg,
      migrationRunListResponse.executionResponseList,
      migrationMeta
    )
  }

  /**
   * Check if user who triggered action is part of any service owner's team
   * @param migrationMeta
   * @param teamByName
   * @returns
   */
  #validateOwnerTeam(migrationMeta: MigrationMeta, teamByName: { [key: string]: string[] }): boolean {
    const triggeredByName = migrationMeta.triggeredBy.login

    // check if user who triggered action is part of any team
    return this.#config.ownerTeams.some(teamName => {
      if (!teamByName[teamName]) {
        return false
      }
      if (teamByName[teamName].includes(triggeredByName)) {
        return true
      }
      return false
    })
  }

  async #runMigrationsForExecution(
    pullRequest: gha.PullRequest,
    migrationMeta: MigrationMeta
  ): Promise<RunMigrationResult | null> {
    core.info(`fn:runMigrationsForExecution PR#${pullRequest.number}, Dry Run: true, Source=${migrationMeta.source}`)
    const commentBuilderFn = commentBuilder('Migrations', pullRequest.base.repo.html_url, false)

    const [prApprovedByUserList, secretMap] = await Promise.all([
      this.#getRequiredApprovalList(pullRequest.number),
      this.#aws.getSecrets(this.#config.dbSecretNameList)
    ])

    /**
     * 1. Get migration file listing
     * 2. Get github teams
     */
    const [teams, migrationConfigList] = await Promise.all([
      // Fetch approved grouped by allowed teams
      this.#matchTeamWithPRApprovers(prApprovedByUserList),
      // Build configuration
      buildMigrationConfigList(this.#config.baseDirectory, this.#config.databases, secretMap)
    ])

    core.debug(`matchTeamWithPRApprovers: ${JSON.stringify(teams)}`)

    let failureMsg = ''
    // If required approvals are not in place
    if (teams.approvalMissingFromTeam.length > 0) {
      failureMsg = `PR is not approved by ${teams.approvalMissingFromTeam
        .map(teamName => `@${pullRequest.base.repo.owner.login}/${teamName}`)
        .join(', ')}`
    }
    // If user who triggered action is not part of any owner team
    else if (this.#validateOwnerTeam(migrationMeta, teams.teamByName) === false) {
      failureMsg = 'User is not part of any owner team'
    }

    if (failureMsg) {
      core.setFailed(failureMsg)
      await this.#addCommentWithFileListing(pullRequest, commentBuilderFn('failed', failureMsg), [], migrationMeta)
      return null
    }

    const migrationRunListResponse = await runMigrationFromList(migrationConfigList, false)

    const result: RunMigrationResult = {
      executionResponseList: migrationRunListResponse.executionResponseList,
      migrationAvailable: migrationRunListResponse.migrationAvailable,
      ignore: false
    }

    if (migrationRunListResponse.errMsg !== null) {
      result.ignore = true
      await this.#addCommentWithFileListing(
        pullRequest,
        commentBuilderFn('failed', migrationRunListResponse.errMsg),
        migrationRunListResponse.executionResponseList,
        migrationMeta
      )
      core.setFailed(migrationRunListResponse.errMsg)
    } else if (migrationRunListResponse.migrationAvailable === false) {
      result.ignore = true
      if (pullRequest.labels.some(label => label.name === this.#config.prLabel)) {
        await this.#addCommentWithFileListing(
          pullRequest,
          commentBuilderFn('failed', 'No migrations available'),
          migrationRunListResponse.executionResponseList,
          migrationMeta
        )
        core.debug('No migrations available')
      }
    }

    if (result.ignore) {
      return result
    }

    // Migrations ran successfully
    let successMsg = 'Migrations ran successfully.'
    if (migrationMeta.source === 'review') {
      successMsg = `${migrationMeta.triggeredBy.login} approved the PR. Migrations ran successfully.`
    }

    console.log('Ran Successfully: ', successMsg)

    await this.#addCommentWithFileListing(
      pullRequest,
      commentBuilderFn('successful', successMsg),
      migrationRunListResponse.executionResponseList,
      migrationMeta
    )

    return result
  }

  async #getRequiredApprovalList(prNumber: number): Promise<string[]> {
    if (this.#config.approvalTeams.length === 0) {
      return await Promise.resolve([])
    }
    return await this.#client.getPullRequestApprovedUserList(prNumber)
  }

  async #runMigrationForDryRun(pr: gha.PullRequest, migrationMeta: MigrationMeta): Promise<RunMigrationResult> {
    core.info(`fn:runMigrationForDryRun PR#${pr.number}, Dry Run: true, Source=${migrationMeta.source}`)

    const migrationConfigList = await buildMigrationConfigList(
      this.#config.baseDirectory,
      this.#config.databases,
      await this.#aws.getSecrets(this.#config.dbSecretNameList)
    )
    const migrationRunListResponse = await runMigrationFromList(migrationConfigList, true)

    if (
      migrationRunListResponse.migrationAvailable === false &&
      migrationMeta.skipCommentWhenNoMigrationsAvailable === true
    ) {
      return {
        executionResponseList: migrationRunListResponse.executionResponseList,
        migrationAvailable: migrationRunListResponse.migrationAvailable,
        ignore: true
      }
    }

    await this.#handleDryRunResponse(
      pr,
      migrationRunListResponse,
      commentBuilder('[DryRun] Migrations', pr.base.repo.html_url, false),
      migrationMeta
    )

    return {
      executionResponseList: migrationRunListResponse.executionResponseList,
      migrationAvailable: migrationRunListResponse.migrationAvailable,
      ignore: true
    }
  }

  /**
   * Check all three reviews are received from required teams
   * @param event
   * @returns
   */
  async #processPullRequestReview(event: gha.ContextPullRequestReview): Promise<RunMigrationResult> {
    if (!this.#hasLabel(event.payload.pull_request.labels, this.#config.prLabel)) {
      this.#skipProcessingHandler(`${event.eventName}, reason=label missing`, event.payload)
      return {
        executionResponseList: [],
        migrationAvailable: false,
        ignore: true
      }
    }
    const { payload } = event
    const result = await this.#runMigrationForDryRun(payload.pull_request, {
      eventName: event.eventName,
      actionName: payload.action,
      skipCommentWhenNoMigrationsAvailable: true,
      source: 'review',
      triggeredBy: payload.sender || payload.review.user
    })

    if (result.migrationAvailable) {
      // We can create JIRA ticket if required
      await this.#ensureLabel(payload.pull_request.number, payload.pull_request.labels, this.#config.prLabel)
    }
    return result
  }

  async #processPullRequestComment(event: gha.ContextPullRequestComment): Promise<RunMigrationResult | null> {
    const commentBody = event.payload.comment.body

    const migrationMeta: MigrationMeta = {
      eventName: event.eventName,
      actionName: event.payload.action,
      source: 'comment',
      triggeredBy: event.payload.sender,
      commentId: event.payload.comment.id,
      commentBody: event.payload.comment.body
    }
    let result: RunMigrationResult | null = null
    if (commentBody === 'db migrate dry-run') {
      result = await this.#runMigrationForDryRun(event.payload.issue, migrationMeta)
    } else if (commentBody === 'db migrate') {
      result = await this.#runMigrationsForExecution(event.payload.issue, migrationMeta)
    }

    if (result?.migrationAvailable) {
      // We can create JIRA ticket if required
      await this.#ensureLabel(event.payload.issue.number, event.payload.issue.labels, this.#config.prLabel)
    }
    return result
  }

  #skipProcessingHandler(eventName: string, payload: { action: string }): void {
    core.info(`Invalid event: event=${eventName} action=${payload.action}`)
  }

  async processEvent(event: gha.Context): Promise<void> {
    const { payload, eventName } = event

    core.setOutput('event_type', `${eventName}:${payload.action}`)

    const errMsg = this.#validatePullRequest('pull_request' in payload ? payload.pull_request : payload.issue)
    if (errMsg) {
      console.info(errMsg)
      return
    }

    if (eventName === 'pull_request_review') {
      if (payload.action !== 'submitted') {
        return this.#skipProcessingHandler(eventName, payload)
      }
      await this.#processPullRequestReview(event)
    } else if (eventName === 'issue_comment') {
      if (payload.action !== 'created') {
        return this.#skipProcessingHandler(eventName, payload)
      }
      await this.#processPullRequestComment(event)
    } else if (eventName === 'pull_request') {
      if (payload.action !== 'opened' && payload.action !== 'reopened' && payload.action !== 'synchronize') {
        return this.#skipProcessingHandler(eventName, payload)
      }
      await this.#processPullRequest(event)
    } else {
      return this.#skipProcessingHandler(eventName, payload)
    }
  }

  async mapIssueToPullRequest(issue: gha.PullRequest): Promise<void> {
    const { pullRequest, defaultBranchRef } = await this.#client.getPRInformation(issue.number)

    issue.base = {
      ref: pullRequest.baseRef.name,
      repo: {
        default_branch: defaultBranchRef.name,
        html_url: pullRequest.baseRef.repository.url,
        language: pullRequest.baseRef.repository.primaryLanguage?.name || null,
        name: pullRequest.baseRef.repository.name,
        owner: {
          login: pullRequest.baseRef.repository.owner.login
        }
      }
    }
  }
}
