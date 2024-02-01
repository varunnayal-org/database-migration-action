import * as core from '@actions/core'
import * as gha from './types.gha'
import { JiraIssue, JiraClient } from './types.jira'
import * as migration from './migration/migration'
import {
  Config,
  MatchTeamWithPRApproverResult,
  RunMigrationResult,
  MigrationMeta,
  MigrationLintResponse,
  MigrationConfig,
  ChangedFileValidationError,
  NotifyParams,
  NotifyResponse,
  Builder
} from './types'
import { VaultClient } from './client/vault/types'
import * as validators from './validators'
import {
  CMD_DRY_RUN,
  CMD_DRY_RUN_JIRA,
  CMD_APPLY,
  NO_MIGRATION_AVAILABLE,
  DEFAULT_PR_JIRA_TICKET_LABEL
} from './constants'

export default class MigrationService {
  #ghClient: gha.GHClient
  #jiraClient: JiraClient | null
  #secretClient: VaultClient
  #config: Config
  #factory: Builder

  constructor(config: Config, factory: Builder) {
    this.#config = config
    this.#factory = factory

    this.#ghClient = factory.getGithub()
    this.#jiraClient = factory.getJira(config.jira)
    this.#secretClient = factory.getVault()
  }

  init(org: string, repoOwner: string, repoName: string): void {
    this.#ghClient.setOrg(org, repoOwner, repoName)
  }

  #hasLabel(labels: gha.Label[], label: string): boolean {
    return labels.some(labelEntry => labelEntry.name === label)
  }

  async #ensureLabels(pullRequest: gha.PullRequest, jiraIssue?: JiraIssue): Promise<void> {
    const labelsToAdd = []

    if (this.#hasLabel(pullRequest.labels, this.#config.prLabel) === false) {
      labelsToAdd.push(this.#config.prLabel)
    }
    if (jiraIssue && this.#hasLabel(pullRequest.labels, DEFAULT_PR_JIRA_TICKET_LABEL) === false) {
      labelsToAdd.push(DEFAULT_PR_JIRA_TICKET_LABEL)
    }

    if (labelsToAdd.length > 0) {
      await this.#ghClient.addLabel(pullRequest.number, labelsToAdd)
    }
  }

  async #processChangedFileValidationError(
    validationErr: ChangedFileValidationError,
    pr: gha.PullRequest,
    migrationMeta: MigrationMeta
  ): Promise<void> {
    await this.#buildCommentInfo(true, {
      pr,
      migrationMeta,
      migrationRunListResponse: { migrationAvailable: false, executionResponseList: [] },
      changedFileValidation: validationErr,
      closePR: true
    })
  }

  /**
   *
   * @param prApprovedByUserList This list is empty even if PR has been approved if config.approvalTeams is empty
   * @returns
   */
  async #matchTeamWithPRApprovers(prApprovedByUserList: string[]): Promise<MatchTeamWithPRApproverResult> {
    // No need to call API when
    // - approvals are required
    // - and, no one has approved the PR yet
    if (this.#config.approvalTeams.length > 0 && prApprovedByUserList.length === 0) {
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

    const teamByName = await this.#ghClient.getUserForTeams(this.#config.allTeams, 100)

    const result: MatchTeamWithPRApproverResult = {
      teamByName,
      prApprovedUserListByTeam: {},
      approvalMissingFromTeam: []
    }

    for (const teamName of this.#config.approvalTeams) {
      const filteredMember = prApprovedByUserList.filter(user => (teamByName[teamName] || []).includes(user))
      result.prApprovedUserListByTeam[teamName] = filteredMember
      if (filteredMember.length === 0) {
        result.approvalMissingFromTeam.push(teamName)
      }
    }

    return result
  }

  async #buildCommentInfo(dryRun: boolean, params: NotifyParams): Promise<NotifyResponse> {
    const notifier = this.#factory.getNotifier(dryRun, this.#config, this.#ghClient, this.#jiraClient)
    return await notifier.notify(params)
  }

  async #runMigrationsForExecution(
    pullRequest: gha.PullRequest,
    migrationMeta: MigrationMeta
  ): Promise<RunMigrationResult | null> {
    // TODO: Check for label db-migration
    core.info(`fn:runMigrationsForExecution PR#${pullRequest.number}, Dry Run: true, Source=${migrationMeta.source}`)
    const [prApprovedByUserList, secretMap] = await Promise.all([
      this.#getRequiredApprovalList(pullRequest.number),
      this.#secretClient.getSecrets(this.#config.dbSecretNameList)
    ])

    const [migrationConfigList, jiraIssue] = await Promise.all([
      // Build configuration
      migration.buildMigrationConfigList(
        this.#config.baseDirectory,
        this.#config.databases,
        this.#config.devDBUrl,
        secretMap
      ),
      // Fetch JIRA Issue
      this.#jiraClient?.findIssue(pullRequest.html_url) ?? Promise.resolve(undefined)
    ])

    let failureMsg = validators.validateMigrationExecutionForJiraApproval(this.#config.jira, jiraIssue)

    if (!failureMsg) {
      // Fetch approved grouped by allowed teams
      const teams = await this.#matchTeamWithPRApprovers(prApprovedByUserList)
      core.debug(`matchTeamWithPRApprovers: ${JSON.stringify(teams)}`)
      failureMsg = validators.validateMigrationExecutionForApproval(
        pullRequest,
        migrationMeta,
        this.#config.ownerTeams,
        teams
      )
    }

    const buildCommentInfoFn = this.#buildCommentInfo.bind(this, false)

    if (failureMsg) {
      core.setFailed(failureMsg)
      await buildCommentInfoFn({
        pr: pullRequest,
        migrationMeta,
        migrationRunListResponse: { executionResponseList: [], migrationAvailable: false, errMsg: failureMsg }
      })
      return null
    }

    const lintResponseList = await migration.runLintFromList(
      migrationConfigList,
      this.#getLintErrorCodesThatCanBeSkipped(pullRequest.labels),
      this.#config.lintCodePrefixes
    )

    if (lintResponseList.errMsg && lintResponseList.canSkipAllErrors === false) {
      core.setFailed(lintResponseList.errMsg)
      await buildCommentInfoFn({
        pr: pullRequest,
        migrationMeta,
        lintResponseList,
        jiraIssue,
        migrationRunListResponse: { migrationAvailable: false, executionResponseList: [] }
      })
      return {
        ignore: true,
        executionResponseList: [],
        migrationAvailable: false,
        lintResponseList
      }
    }

    const migrationRunListResponse = await migration.runMigrationFromList(migrationConfigList, false)

    const result: RunMigrationResult = {
      lintResponseList,
      executionResponseList: migrationRunListResponse.executionResponseList,
      migrationAvailable: migrationRunListResponse.migrationAvailable,
      ignore: false
    }

    if (migrationRunListResponse.errMsg) {
      result.ignore = true
      await buildCommentInfoFn({ pr: pullRequest, migrationMeta, migrationRunListResponse })
      core.setFailed(migrationRunListResponse.errMsg)
    } else if (migrationRunListResponse.migrationAvailable === false) {
      result.ignore = true
      migrationRunListResponse.errMsg = NO_MIGRATION_AVAILABLE
      if (pullRequest.labels.some(label => label.name === this.#config.prLabel)) {
        await buildCommentInfoFn({ pr: pullRequest, migrationMeta, migrationRunListResponse })
        core.error(NO_MIGRATION_AVAILABLE)
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

    core.info(`Ran Successfully: ${successMsg}`)

    await buildCommentInfoFn({ pr: pullRequest, migrationMeta, migrationRunListResponse })

    return result
  }

  async #getRequiredApprovalList(prNumber: number): Promise<string[]> {
    if (this.#config.approvalTeams.length === 0) {
      return await Promise.resolve([])
    }
    return await this.#ghClient.getPullRequestApprovedUserList(prNumber)
  }

  #getLintErrorCodesThatCanBeSkipped(labels: gha.Label[]): string[] {
    return labels
      .filter(label => label.name.startsWith(this.#config.lintSkipErrorLabelPrefix))
      .map(label => label.name.split(this.#config.lintSkipErrorLabelPrefix)[1])
      .filter(Boolean)
  }

  async #runMigrationForDryRun(
    pr: gha.PullRequest,
    migrationMeta: MigrationMeta,
    migrationConfigList?: MigrationConfig[]
  ): Promise<RunMigrationResult> {
    core.info(`fn:runMigrationForDryRun PR#${pr.number}, Dry Run: true, Source=${migrationMeta.source}`)

    if (migrationConfigList) {
      await migration.hydrateMigrationConfigList(
        migrationConfigList,
        this.#config.databases,
        await this.#secretClient.getSecrets(this.#config.dbSecretNameList)
      )
    } else {
      migrationConfigList = await migration.buildMigrationConfigList(
        this.#config.baseDirectory,
        this.#config.databases,
        this.#config.devDBUrl,
        await this.#secretClient.getSecrets(this.#config.dbSecretNameList)
      )
    }

    let lintResponseList: MigrationLintResponse | undefined
    if (migrationMeta.lintRequired) {
      lintResponseList = await migration.runLintFromList(
        migrationConfigList,
        // codes like: ['PG103', 'BC102', 'DS103']
        this.#getLintErrorCodesThatCanBeSkipped(pr.labels),
        this.#config.lintCodePrefixes
      )
    }

    const migrationRunListResponse = await migration.runMigrationFromList(migrationConfigList, true)

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

    if (lintResponseList?.errMsg && lintResponseList.canSkipAllErrors === false) {
      core.setFailed(lintResponseList.errMsg)
    } else if (migrationRunListResponse.errMsg) {
      core.setFailed(migrationRunListResponse.errMsg)
    }

    const { jiraIssue } = await this.#buildCommentInfo(true, {
      pr,
      migrationMeta,
      migrationRunListResponse,
      lintResponseList,
      addMigrationRunResponseForLint: true
    })

    return {
      executionResponseList: migrationRunListResponse.executionResponseList,
      migrationAvailable: migrationRunListResponse.migrationAvailable,
      jiraIssue,
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
      await this.#ensureLabels(payload.pull_request, result.jiraIssue)
    }
    return result
  }

  /**
   * Add label if not present
   *
   * @param {gha.ContextPullRequest} event
   */
  async #processPullRequest(event: gha.ContextPullRequest): Promise<RunMigrationResult> {
    const { payload } = event
    const pr = payload.pull_request
    const migrationMeta: MigrationMeta = {
      eventName: event.eventName,
      actionName: payload.action,
      source: 'pr',
      triggeredBy: pr.user,
      ensureJiraTicket: true,
      lintRequired: true
    }
    const migrationConfigList = await migration.buildMigrationConfigList(
      this.#config.baseDirectory,
      this.#config.databases,
      this.#config.devDBUrl,
      {},
      false
    )

    const validationResult = validators.validateChangedFiles(
      migrationConfigList,
      await this.#ghClient.getChangedFiles(pr.number),
      this.#config.configFileName
    )
    if (validationResult) {
      if (validationResult.migrationAvailable) {
        core.setFailed(validationResult.errMsg)
        await this.#processChangedFileValidationError(validationResult, pr, migrationMeta)
      }
      return {
        executionResponseList: [],
        migrationAvailable: validationResult.migrationAvailable,
        ignore: true
      }
    }

    // validate files
    const result = await this.#runMigrationForDryRun(pr, migrationMeta, migrationConfigList)

    if (result.migrationAvailable) {
      await this.#ensureLabels(pr, result.jiraIssue)
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
      lintRequired: true,
      commentBody: event.payload.comment.body
    }

    let result: RunMigrationResult | null = null
    if (commentBody === CMD_DRY_RUN) {
      result = await this.#runMigrationForDryRun(event.payload.issue, migrationMeta)
    } else if (commentBody === CMD_APPLY) {
      result = await this.#runMigrationsForExecution(event.payload.issue, migrationMeta)
    } else if (commentBody === CMD_DRY_RUN_JIRA) {
      migrationMeta.ensureJiraTicket = true
      result = await this.#runMigrationForDryRun(event.payload.issue, migrationMeta)
    }

    if (result?.migrationAvailable) {
      await this.#ensureLabels(event.payload.issue, result.jiraIssue)
    }
    return result
  }

  skipProcessingHandler(eventName: string, payload: { action: string }): void {
    core.info(`Invalid event: event=${eventName} action=${payload.action}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processEvent(event: Exclude<gha.Context, gha.ContextSchedule>): Promise<any> {
    const { payload, eventName } = event

    core.setOutput('event_type', `${eventName}:${payload.action}`)

    const errMsg = validators.validatePullRequest(
      'pull_request' in payload ? payload.pull_request : payload.issue,
      this.#config.baseBranch
    )
    if (errMsg) {
      core.error(errMsg)
      return
    }

    if (eventName === 'pull_request_review') {
      if (payload.action !== 'submitted') {
        return this.skipProcessingHandler(eventName, payload)
      }
      return await this.#processPullRequestReview(event)
    } else if (eventName === 'issue_comment') {
      if (payload.action !== 'created') {
        return this.skipProcessingHandler(eventName, payload)
      }
      return await this.#processPullRequestComment(event)
    } else if (eventName === 'pull_request') {
      if (payload.action !== 'opened' && payload.action !== 'reopened' && payload.action !== 'synchronize') {
        return this.skipProcessingHandler(eventName, payload)
      }
      return await this.#processPullRequest(event)
    } else {
      return this.skipProcessingHandler(eventName, payload)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processDrift(event: gha.ContextSchedule): Promise<any> {
    const { payload, eventName } = event
    if (eventName !== 'schedule') {
      return this.skipProcessingHandler(eventName, { action: payload.schedule })
    }

    const secretMap = await this.#secretClient.getSecrets(this.#config.dbSecretNameList)
    const migrationConfigList = await migration.buildMigrationConfigList(
      this.#config.baseDirectory,
      this.#config.databases,
      this.#config.devDBUrl,
      secretMap
    )
    const driftRunListResponse = await migration.runSchemaDriftFromList(migrationConfigList)

    // No unexpected error and no drift, return early. No need to call JIRA
    if (!driftRunListResponse.errMsg && driftRunListResponse.hasSchemaDrifts === false) {
      core.debug('No drifts present')
      return Promise.resolve({ driftRunListResponse })
    }

    const jiraIssue = await (this.#jiraClient?.findSchemaDriftIssue(
      payload.repository.html_url,
      this.#config.jira?.doneValue || ''
    ) ?? Promise.resolve(undefined))

    const notifier = this.#factory.getNotifier(false, this.#config, this.#ghClient, this.#jiraClient)

    const driftResponse = await notifier.drift({
      driftRunListResponse,
      repo: payload.repository,
      jiraIssue
    })

    return {
      driftRunListResponse,
      ...driftResponse
    }
  }

  async mapIssueToPullRequest(issue: gha.PullRequest): Promise<void> {
    const { pullRequest, defaultBranchRef } = await this.#ghClient.getPRInformation(issue.number)

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
