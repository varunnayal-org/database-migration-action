import * as core from '@actions/core'
import GHClient, { IssueCreateCommentResponse, IssueUpdateCommentResponse } from './client/github'
import { Config } from './config'
import * as gha from './types.gha'
import { runMigrationFromList, buildMigrationConfigList, getDirectoryForDb } from './migration/migration'
import { MigrationRunListResponse, MatchTeamWithPRApproverResult, RunMigrationResult, MigrationMeta } from './types'
import { VaultClient } from './client/vault/types'
import { CommentBuilder } from './formatting/comment-builder'

export default class MigrationService {
  #client: GHClient
  secretClient: VaultClient
  #config: Config

  constructor(config: Config, client: GHClient, secretClient: VaultClient) {
    this.#config = config
    this.#client = client
    this.secretClient = secretClient
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

  async #setupComment(
    isJiraEvent: boolean,
    dryRun: boolean,
    pullRequest: gha.PullRequest,
    migrationMeta: MigrationMeta,
    migrationRunListResponse: MigrationRunListResponse
  ): Promise<IssueUpdateCommentResponse | IssueCreateCommentResponse> {
    const builder = new CommentBuilder(
      dryRun,
      pullRequest.base.repo.html_url,
      this.#config.databases.map(db => getDirectoryForDb(this.#config.baseDirectory, db))
    )

    let commentMsg = builder.build(isJiraEvent, migrationRunListResponse)

    // Write summary for gh action
    core.summary.addRaw(commentMsg)

    let ghCommentPromise: Promise<IssueUpdateCommentResponse | IssueCreateCommentResponse>
    if ('commentId' in migrationMeta) {
      commentMsg = `${migrationMeta.commentBody}\r\n\r\n${commentMsg}`
      ghCommentPromise = this.#client.updateComment(migrationMeta.commentId, commentMsg)
      core.debug(`Updating comment=${migrationMeta.commentId}\nMsg=${commentMsg}`)
    } else {
      commentMsg = `Executed By: ${builder
        .getFormatter(isJiraEvent)
        .userRef(migrationMeta.triggeredBy.login)}\r\nReason=${migrationMeta.eventName}.${
        migrationMeta.actionName
      }\r\n${commentMsg}`
      ghCommentPromise = this.#client.addComment(pullRequest.number, commentMsg)
      core.debug(`Adding comment ${commentMsg}`)
    }

    const response = await Promise.allSettled([core.summary.write(), ghCommentPromise])

    if (response[1].status === 'rejected') {
      throw response[1].reason
    }

    return response[1].value
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
    const [prApprovedByUserList, secretMap] = await Promise.all([
      this.#getRequiredApprovalList(pullRequest.number),
      this.secretClient.getSecrets(this.#config.dbSecretNameList)
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

    const setupCommentFn = this.#setupComment.bind(this, false, false, pullRequest, migrationMeta)
    if (failureMsg) {
      core.setFailed(failureMsg)
      await setupCommentFn({ executionResponseList: [], migrationAvailable: false, errMsg: failureMsg })
      return null
    }

    const migrationRunListResponse = await runMigrationFromList(migrationConfigList, false)

    const result: RunMigrationResult = {
      executionResponseList: migrationRunListResponse.executionResponseList,
      migrationAvailable: migrationRunListResponse.migrationAvailable,
      ignore: false
    }

    if (migrationRunListResponse.errMsg) {
      result.ignore = true
      await setupCommentFn(migrationRunListResponse)
      core.setFailed(migrationRunListResponse.errMsg)
    } else if (migrationRunListResponse.migrationAvailable === false) {
      result.ignore = true
      migrationRunListResponse.errMsg = 'No migrations available'
      if (pullRequest.labels.some(label => label.name === this.#config.prLabel)) {
        await setupCommentFn(migrationRunListResponse)
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

    await setupCommentFn(migrationRunListResponse)

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
      await this.secretClient.getSecrets(this.#config.dbSecretNameList)
    )
    const migrationRunListResponse = await runMigrationFromList(migrationConfigList, true)

    if (
      !migrationRunListResponse.errMsg &&
      migrationRunListResponse.migrationAvailable === false &&
      migrationMeta.skipCommentWhenNoMigrationsAvailable === true
    ) {
      return {
        executionResponseList: migrationRunListResponse.executionResponseList,
        migrationAvailable: migrationRunListResponse.migrationAvailable,
        ignore: true
      }
    }

    await this.#setupComment(false, true, pr, migrationMeta, migrationRunListResponse)

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
      this.skipProcessingHandler(`${event.eventName}, reason=label missing`, event.payload)
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

  skipProcessingHandler(eventName: string, payload: { action: string }): void {
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
        return this.skipProcessingHandler(eventName, payload)
      }
      await this.#processPullRequestReview(event)
    } else if (eventName === 'issue_comment') {
      if (payload.action !== 'created') {
        return this.skipProcessingHandler(eventName, payload)
      }
      await this.#processPullRequestComment(event)
    } else if (eventName === 'pull_request') {
      if (payload.action !== 'opened' && payload.action !== 'reopened' && payload.action !== 'synchronize') {
        return this.skipProcessingHandler(eventName, payload)
      }
      await this.#processPullRequest(event)
    } else {
      return this.skipProcessingHandler(eventName, payload)
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
