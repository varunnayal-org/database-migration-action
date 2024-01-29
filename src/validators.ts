import path from 'path'
import * as core from '@actions/core'

import { ChangedFileValidationError, MatchTeamWithPRApproverResult, MigrationConfig, MigrationMeta } from './types'
import * as util from './util'
import { ALLOWED_CHANGED_FILE_EXTENSION, CMD_DRY_RUN, NO_MIGRATION_AVAILABLE, UNWANTED_FILES_FOUND } from './constants'
import { Config, JiraIssue } from './types.jira'
import * as gha from './types.gha'

export function validatePullRequest(pullRequest: gha.PullRequest, baseBranch: string): string | undefined {
  const { base } = pullRequest
  if (base.ref !== baseBranch) {
    return `Base branch should be ${baseBranch}, found ${base.ref}`
  } else if (pullRequest.state !== 'open') {
    return `PR is in ${pullRequest.state} state`
  } else if (pullRequest.draft) {
    return 'PR is in draft state'
  }
}

export function validateOwnerTeam(
  migrationMeta: MigrationMeta,
  ownerTeams: string[],
  teamByName: { [key: string]: string[] }
): boolean {
  const triggeredByName = migrationMeta.triggeredBy.login

  // check if user who triggered action is part of any team
  return ownerTeams.some(teamName => {
    if (!teamByName[teamName]) {
      return false
    }
    if (teamByName[teamName].includes(triggeredByName)) {
      return true
    }
    return false
  })
}

export function validateMigrationExecutionForApproval(
  pullRequest: gha.PullRequest,
  migrationMeta: MigrationMeta,
  ownerTeams: string[],
  teams: MatchTeamWithPRApproverResult
): string | undefined {
  // If required approvals are not in place
  if (teams.approvalMissingFromTeam.length > 0) {
    return `PR is not approved by ${teams.approvalMissingFromTeam
      .map(teamName => `@${pullRequest.base.repo.owner.login}/${teamName}`)
      .join(', ')}`
  }

  // If user who triggered action is not part of any owner team
  if (validateOwnerTeam(migrationMeta, ownerTeams, teams.teamByName) === false) {
    return 'User is not part of any owner team'
  }
}

export function validateMigrationExecutionForJiraApproval(
  jiraConfig: Config | undefined,
  jiraIssue: JiraIssue | null | undefined
): string | undefined {
  if (!jiraConfig) {
    return undefined
  }

  // Jira ticket not created
  if (!jiraIssue) {
    return `JIRA Issue not found. Please add comment *${CMD_DRY_RUN}* to create JIRA ticket`
  }

  // Ticket not resolved
  if (jiraIssue.fields.resolution?.name !== jiraConfig.doneValue) {
    return `JIRA Issue ${jiraIssue.key} is not resolved yet (state=${jiraIssue.fields.resolution?.name || 'NA'})`
  }
  // DRI Approvals missing
  const missingDRIApprovals = (jiraConfig.fields.driApprovals || []).filter(field => {
    if (!jiraIssue.fields[field]) {
      return true
    }
    return jiraIssue.fields[field].value !== jiraConfig.approvalStatus
  })
  if (missingDRIApprovals.length > 0) {
    return `JIRA Issue is not approved by DRIs ${missingDRIApprovals.join(', ')}`
  }
  return undefined
}

export function validateChangedFiles(
  migrationConfigList: MigrationConfig[],
  changedFiles: string[],
  configFileName: string
): ChangedFileValidationError | undefined {
  let hasMigrationVersionFile = false
  if (changedFiles.length === 0) {
    return { errMsg: 'No files changed', unmatched: [], migrationAvailable: hasMigrationVersionFile }
  }

  const { matched, unmatched } = util.globFromList(
    migrationConfigList.map(migrationConfig => util.getRelativePathForDbDirectory(migrationConfig.originalDir)),
    changedFiles
  )

  // check matched files
  for (let idx = 0; idx < matched.length; idx++) {
    const matchedFiles = matched[idx].filter(file => util.hasExtension(file, '.sql'))

    migrationConfigList[idx].lintLatestFiles = matchedFiles.length
    hasMigrationVersionFile = hasMigrationVersionFile || matchedFiles.length > 0
  }

  if (hasMigrationVersionFile === false) {
    core.debug('No migrations files found')
    return { errMsg: NO_MIGRATION_AVAILABLE, unmatched: [], migrationAvailable: hasMigrationVersionFile }
  }

  // check unmatched files
  const unmatchedFilesToConsider = unmatched.filter(file => {
    // "./db.migration.json" to "db.migration.json"
    if (file === path.relative('.', configFileName) || file === 'Makefile') {
      return false
    }

    if (util.hasExtensions(file, ALLOWED_CHANGED_FILE_EXTENSION)) {
      return false
    }

    return true
  })
  if (unmatchedFilesToConsider.length > 0) {
    core.error(`Found unwanted files: ${JSON.stringify(unmatchedFilesToConsider, null, 2)}`)
    return {
      errMsg: UNWANTED_FILES_FOUND,
      migrationAvailable: hasMigrationVersionFile,
      unmatched: unmatchedFilesToConsider
    }
  }
}
