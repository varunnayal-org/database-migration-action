import path from 'path'
import * as core from '@actions/core'
import GHClient from './client/github'
import JiraClient, { JiraIssue } from './client/jira'
import { Config } from './config'
import * as gha from './types.gha'
import {
  runMigrationFromList,
  buildMigrationConfigList,
  runLintFromList,
  hydrateMigrationConfigList,
  hasExtensions,
  hasExtension,
  getRelativePathForDbDirectory
} from './migration/migration'
import {
  MatchTeamWithPRApproverResult,
  RunMigrationResult,
  MigrationMeta,
  MigrationLintResponse,
  MigrationConfig,
  ChangedFileValidationError
} from './types'
import { VaultClient } from './client/vault/types'
import { NotifierService, NotifyParams, NotifyResponse } from './notifier.service'
import { globFromList } from './util'

const CMD_DRY_RUN = 'db migrate dry-run'
const CMD_DRY_RUN_JIRA = 'db migrate jira'
const CMD_APPLY = 'db migrate'
const NO_MIGRATION_AVAILABLE = '1No migrations available'

export default class MigrationService {
  #ghClient: GHClient
  #jiraClient: JiraClient | null
  secretClient: VaultClient
  #config: Config

  constructor(config: Config, client: GHClient, jiraClient: JiraClient | null, secretClient: VaultClient) {
    this.#config = config
    this.#ghClient = client
    this.#jiraClient = jiraClient
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

  async #ensureLabels(pullRequest: gha.PullRequest, jiraIssue?: JiraIssue): Promise<void> {
    let labelsToAdd = [this.#config.prLabel]
    if (jiraIssue) {
      labelsToAdd.push('jira-ticket-created')
    }

    labelsToAdd = labelsToAdd.filter(label => !this.#hasLabel(pullRequest.labels, label))

    if (labelsToAdd.length > 0) {
      await this.#ghClient.addLabel(pullRequest.number, labelsToAdd)
    }
  }

  async #validateChangedFiles(
    pullRequest: gha.PullRequest,
    migrationConfigList: MigrationConfig[]
  ): Promise<ChangedFileValidationError | undefined> {
    const changedFiles = await this.#ghClient.getChangedFiles(pullRequest.number)
    let hasMigrationVersionFile = false
    if (changedFiles.length === 0) {
      return { errMsg: 'No files changed', unmatched: [], migrationAvailable: hasMigrationVersionFile }
    }

    const { matched, unmatched } = globFromList(
      migrationConfigList.map(migrationConfig => getRelativePathForDbDirectory(migrationConfig.dir)),
      changedFiles
    )

    for (let idx = 0; idx < matched.length; idx++) {
      const matchedFiles = matched[idx].filter(file => hasExtension(file, '.sql'))

      migrationConfigList[idx].lintLatestFiles = matchedFiles.length
      hasMigrationVersionFile = hasMigrationVersionFile || matchedFiles.length > 0
    }

    if (hasMigrationVersionFile === false) {
      core.debug('No migrations files found')
      return { errMsg: NO_MIGRATION_AVAILABLE, unmatched: [], migrationAvailable: hasMigrationVersionFile }
    }

    const unmatchedFilesToConsider = unmatched.filter(file => {
      // "./db.migration.json" to "db.migration.json"
      if (file === path.relative('.', this.#config.configFileName) || file === 'Makefile') {
        return false
      }

      if (hasExtensions(file, ['.yml', '.yaml', '.sql'])) {
        return false
      }

      return true
    })
    if (unmatchedFilesToConsider.length > 0) {
      core.error(`Found unwanted files: ${JSON.stringify(unmatchedFilesToConsider, null, 2)}`)
      return {
        errMsg: 'Unwanted files found',
        migrationAvailable: hasMigrationVersionFile,
        unmatched: unmatchedFilesToConsider
      }
    }
  }

  async #processChangedFileValidationError(
    validationErr: ChangedFileValidationError,
    pr: gha.PullRequest,
    migrationMeta: MigrationMeta
  ): Promise<void> {
    await this.#buildCommentInfo(true, pr, migrationMeta, {
      migrationRunListResponse: { migrationAvailable: false, executionResponseList: [] },
      changedFileValidation: validationErr
    })
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
    const migrationConfigList = await buildMigrationConfigList(
      this.#config.baseDirectory,
      this.#config.databases,
      this.#config.devDBUrl,
      {},
      false
    )

    const validationResult = await this.#validateChangedFiles(pr, migrationConfigList)
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
      const filteredMember = prApprovedByUserList.filter(user => teamByName[teamName].includes(user))
      result.prApprovedUserListByTeam[teamName] = filteredMember
      if (filteredMember.length === 0) {
        result.approvalMissingFromTeam.push(teamName)
      }
    }

    return result
  }

  async #buildCommentInfo(
    dryRun: boolean,
    pullRequest: gha.PullRequest,
    migrationMeta: MigrationMeta,
    params: NotifyParams
  ): Promise<NotifyResponse> {
    const notifier = new NotifierService(
      dryRun,
      pullRequest,
      migrationMeta,
      this.#config,
      this.#ghClient,
      this.#jiraClient
    )
    return await notifier.notify(params)
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

  #validateMigrationExecutionForApproval(
    pullRequest: gha.PullRequest,
    migrationMeta: MigrationMeta,
    teams: MatchTeamWithPRApproverResult
  ): string | undefined {
    // If required approvals are not in place
    if (teams.approvalMissingFromTeam.length > 0) {
      return `PR is not approved by ${teams.approvalMissingFromTeam
        .map(teamName => `@${pullRequest.base.repo.owner.login}/${teamName}`)
        .join(', ')}`
    }

    // If user who triggered action is not part of any owner team
    if (this.#validateOwnerTeam(migrationMeta, teams.teamByName) === false) {
      return 'User is not part of any owner team'
    }
  }

  #validateMigrationExecutionForJiraApproval(jiraIssue?: JiraIssue | null | undefined): string | undefined {
    const jiraConfig = this.#config.jira
    if (!jiraConfig) {
      return undefined
    }

    // Jira ticket not created
    if (!jiraIssue) {
      return `JIRA Issue not found. Please add comment *${CMD_DRY_RUN}* to create JIRA ticket`
    }

    // Ticket not resolved
    if (jiraIssue.fields.resolution?.name !== jiraConfig.doneValue) {
      return `JIRA issue ${jiraIssue.key} is not resolved yet ${jiraIssue.fields.resolution?.name || 'NA'}`
    }
    // DRI Approvals missing
    const missingDRIApprovals = (jiraConfig.fields.driApprovals || []).filter(field => {
      if (!jiraIssue.fields[field]) {
        return true
      }
      return jiraIssue.fields[field].value !== jiraConfig.approvalStatus
    })
    if (missingDRIApprovals.length > 0) {
      return `JIRA Issue is not approved by DRIs ${missingDRIApprovals}`
    }
    return undefined
  }

  async #runMigrationsForExecution(
    pullRequest: gha.PullRequest,
    migrationMeta: MigrationMeta
  ): Promise<RunMigrationResult | null> {
    // TODO: Check for label db-migration
    core.info(`fn:runMigrationsForExecution PR#${pullRequest.number}, Dry Run: true, Source=${migrationMeta.source}`)
    const [prApprovedByUserList, secretMap] = await Promise.all([
      this.#getRequiredApprovalList(pullRequest.number),
      this.secretClient.getSecrets(this.#config.dbSecretNameList)
    ])

    const [migrationConfigList, jiraIssue] = await Promise.all([
      // Build configuration
      buildMigrationConfigList(this.#config.baseDirectory, this.#config.databases, this.#config.devDBUrl, secretMap),
      // Fetch JIRA Issue
      this.#jiraClient?.findIssue(pullRequest.html_url) ?? Promise.resolve(undefined)
    ])

    let failureMsg = this.#validateMigrationExecutionForJiraApproval(jiraIssue)

    if (!failureMsg) {
      // Fetch approved grouped by allowed teams
      const teams = await this.#matchTeamWithPRApprovers(prApprovedByUserList)
      core.debug(`matchTeamWithPRApprovers: ${JSON.stringify(teams)}`)
      failureMsg = this.#validateMigrationExecutionForApproval(pullRequest, migrationMeta, teams)
    }

    const buildCommentInfoFn = this.#buildCommentInfo.bind(this, false, pullRequest, migrationMeta)

    if (failureMsg) {
      core.setFailed(failureMsg)
      await buildCommentInfoFn({
        migrationRunListResponse: { executionResponseList: [], migrationAvailable: false, errMsg: failureMsg }
      })
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
      await buildCommentInfoFn({ migrationRunListResponse })
      core.setFailed(migrationRunListResponse.errMsg)
    } else if (migrationRunListResponse.migrationAvailable === false) {
      result.ignore = true
      migrationRunListResponse.errMsg = NO_MIGRATION_AVAILABLE
      if (pullRequest.labels.some(label => label.name === this.#config.prLabel)) {
        await buildCommentInfoFn({ migrationRunListResponse })
        core.debug(NO_MIGRATION_AVAILABLE)
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

    core.debug(`Ran Successfully: ${successMsg}`)

    await buildCommentInfoFn({ migrationRunListResponse })

    return result
  }

  async #getRequiredApprovalList(prNumber: number): Promise<string[]> {
    if (this.#config.approvalTeams.length === 0) {
      return await Promise.resolve([])
    }
    return await this.#ghClient.getPullRequestApprovedUserList(prNumber)
  }

  async #runMigrationForDryRun(
    pr: gha.PullRequest,
    migrationMeta: MigrationMeta,
    migrationConfigList?: MigrationConfig[]
  ): Promise<RunMigrationResult> {
    core.info(`fn:runMigrationForDryRun PR#${pr.number}, Dry Run: true, Source=${migrationMeta.source}`)

    if (migrationConfigList) {
      await hydrateMigrationConfigList(
        migrationConfigList,
        this.#config.databases,
        await this.secretClient.getSecrets(this.#config.dbSecretNameList)
      )
    } else {
      migrationConfigList = await buildMigrationConfigList(
        this.#config.baseDirectory,
        this.#config.databases,
        this.#config.devDBUrl,
        await this.secretClient.getSecrets(this.#config.dbSecretNameList)
      )
    }

    let lintResponseList: MigrationLintResponse | undefined
    if (migrationMeta.lintRequired) {
      lintResponseList = await runLintFromList(migrationConfigList)
    }

    if (lintResponseList?.errMsg) {
      core.setFailed(lintResponseList.errMsg)
      await this.#buildCommentInfo(true, pr, migrationMeta, {
        migrationRunListResponse: { executionResponseList: [], migrationAvailable: false },
        lintResponseList
      })
      return {
        executionResponseList: [],
        migrationAvailable: false,
        ignore: true
      }
    }

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

    if (migrationRunListResponse.errMsg) {
      core.setFailed(migrationRunListResponse.errMsg)
    }

    const { jiraIssue } = await this.#buildCommentInfo(true, pr, migrationMeta, {
      migrationRunListResponse,
      lintResponseList
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

  async processEvent(event: gha.Context): Promise<void> {
    const { payload, eventName } = event

    core.setOutput('event_type', `${eventName}:${payload.action}`)

    const errMsg = this.#validatePullRequest('pull_request' in payload ? payload.pull_request : payload.issue)
    if (errMsg) {
      core.debug(errMsg)
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
