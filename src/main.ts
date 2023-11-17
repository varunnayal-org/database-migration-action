import fs from 'fs'
import { runMigrationFromList, buildMigrationConfigList } from './migration'
import { getEnv } from './util'
import GHClient, { PRInfo } from './client/github'
import AWSClient, { AWSSecrets } from './client/aws'
import JiraClient from './client/jira'
import buildConfig from './config'
import { GitHubEvent, MigrationConfig } from './types'
import { dataDumper } from './debug'

interface BuildDataParams {
  // Add more fields as required
  actionOrigin: string
  organization: string
  repoOwner: string
  repoName: string
  prNumber: number
  commentBody: string
  commentOwner: string
  awsSecrets: AWSSecrets
  prInfo?: PRInfo
}

interface BuildDataErrMessage {
  // Define the fields of this interface based on what the function returns
  invalidComment: string | null
  invalidPR: string | null
  invalidTeam: string | null
  noFilesToRun: string | null
  invalidDryRun: string | null
}

interface BuildDataResult {
  // Define the fields of this interface based on what the function returns
  msgPrefix: string
  dryRun: boolean
  jiraClient: JiraClient
  migrationConfigList: MigrationConfig[] // Define a more specific type if possible
  migrationAvailable: boolean
  migratedFileList: string[][] // Define a more specific type if possible
  errorMessage: string | null
  errMsg: BuildDataErrMessage
}

const awsClient = new AWSClient()
const ghClient = GHClient.fromEnv()
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const eventData: GitHubEvent = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')) // Use non-null assertion for process.env
const config = buildConfig()

function validatePR(prInfo: PRInfo, prBaseBranch: string, commentOwner: string, dryRun: boolean): string | undefined {
  if (prInfo.baseBranch !== prBaseBranch) {
    return `Base branch should be ${prBaseBranch}`
  } else if (prInfo.author === commentOwner && dryRun === false) {
    return `PR author @${prInfo.author} cannot approve their own PR`
  } else if (!prInfo.isOpen) {
    return `PR is in ${prInfo.state} state`
  } else if (prInfo.isDraft) {
    return `PR is in draft state`
  }
}

function buildExecutionMarkdown(htmlURL: string, isJiraEvent: boolean): string {
  const executionURL = `${htmlURL}/actions/runs/${process.env.GITHUB_RUN_ID}`
  if (isJiraEvent !== true) {
    return `[Execution](${executionURL})`
  }
  return `[Execution|${executionURL}]`
}

async function buildData(params: BuildDataParams): Promise<BuildDataResult> {
  const result: BuildDataResult = {
    msgPrefix: 'Migrations',
    dryRun: true,
    jiraClient: new JiraClient({
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      apiToken: getEnv(config.tokens.jira_token, params.awsSecrets),
      apiUser: getEnv(config.tokens.jira_user, params.awsSecrets),
      jiraDomain: config.jira.domain,
      project: config.jira.project,
      issueType: config.jira.issue_type,
      ticketLabel: config.jira.ticket_label,
      statusIDInitial: config.jira.status_id_initial,
      statusIDCompleted: config.jira.status_id_completed,
      customFieldPRLink: config.jira.custom_field_pr_link,
      customFieldRepoLink: config.jira.custom_field_repo_link
    }),

    migrationConfigList: [],
    migrationAvailable: false,
    migratedFileList: [],

    errorMessage: null,
    errMsg: {
      invalidComment: null,
      invalidPR: null,
      invalidTeam: null,
      noFilesToRun: null,
      invalidDryRun: null
    }
  }

  const commentBody = params.commentBody.trim()
  if (commentBody === '/migrate approved') {
    // Not running migration from github for now
    if (params.actionOrigin !== 'github') {
      result.dryRun = false
    }
  } else if (commentBody === '/migrate dry-run') {
    result.msgPrefix = '[DryRun]Migrations'
    result.dryRun = true
  } else {
    result.errMsg.invalidComment = 'ignoring comment'
    result.errorMessage = result.errMsg.invalidComment
    return result
  }

  if (result.dryRun === true) {
    result.msgPrefix = '[DryRun]Migrations'
  }

  console.log(`Fetching PR info for ${params.repoOwner}/${params.repoName}#${params.prNumber}`)

  const prInfo = params.prInfo || (await ghClient.getPRInfoFromNumber(params.prNumber))
  console.log(`PR Info: `, prInfo)

  const errMsg = validatePR(prInfo, config.base_branch, params.commentOwner, result.dryRun)
  if (errMsg) {
    result.errMsg.invalidPR = errMsg
    result.errorMessage = result.errMsg.invalidPR
    return result
  }

  if (params.actionOrigin === 'github') {
    console.debug(`Fetching teams for user ${params.commentOwner}`)
    const matchingTeams = await ghClient.getMatchingTeams(params.commentOwner, config.teams)

    if (matchingTeams.length === 0) {
      result.errMsg.invalidTeam = `User ${params.commentOwner} is not a member of any of the required teams: ${config.teams}`
      result.errorMessage = result.errMsg.invalidTeam
      return result
    }
  }

  result.migrationConfigList = await buildMigrationConfigList(config, params.awsSecrets)

  const {
    migrationAvailable,
    migratedFileList,
    errMsg: migrationErrMsg
  } = await runMigrationFromList(result.migrationConfigList)

  result.migratedFileList = migratedFileList
  result.migrationAvailable = migrationAvailable
  if (migrationErrMsg) {
    result.errMsg.invalidDryRun = migrationErrMsg
    result.errorMessage = migrationErrMsg
    return result
  } else if (migrationAvailable === false) {
    result.errMsg.noFilesToRun = 'No migrations available'
    result.errorMessage = result.errMsg.noFilesToRun
    return result
  }

  return result
}

function buildJiraDescription(
  organization: string,
  repoName: string,
  prNumber: number,
  fileListForComment: string
): string {
  return `[PR ${organization}/${repoName}#${prNumber}|https://github.com/${organization}/${repoName}/pull/${prNumber}]
${fileListForComment}
`
}

function dt(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Calcutta'
  })
}

async function processGithubEvent1(event: GitHubEvent, awsSecrets: AWSSecrets): Promise<void> {
  const organization = event.organization.login // for orgs, this and repoOwner are same
  const repoOwner = event.repository.owner.login
  const repoName = event.repository.name
  const prAPIUrl = event.issue.pull_request.url
  const prNumber = event.issue.number
  const commentID = event.comment.id
  const repoAPIUrl = event.issue.repository_url
  const repoHtmlUrl = event.repository.html_url

  ghClient.setOrg(organization, repoOwner, repoName)

  const result = await buildData({
    actionOrigin: 'github',
    organization,
    repoOwner,
    repoName,
    prNumber,
    commentBody: event.comment.body,
    commentOwner: event.comment.user.login,
    awsSecrets
  })

  console.log('Result: ', result)
  const commentBuilder = getUpdatedComment(event.comment.body, result.msgPrefix, repoHtmlUrl)

  if (result.errorMessage) {
    if (result.errMsg.invalidComment === null) {
      console.error(result.errorMessage)
      await ghClient.updateComment(commentID, commentBuilder('failed', result.errorMessage))
      throw new Error(result.errorMessage)
    }
    console.debug(result.errorMessage)
    return
  }

  // migration files are available. Ensure we have a ticket handy
  const { alreadyExists, issue: jiraIssue } = await result.jiraClient.ensureJiraTicket(
    prNumber,
    buildJiraDescription(organization, repoName, prNumber, getFileListingForComment(result.migratedFileList)),
    null,
    prAPIUrl,
    repoAPIUrl
  )

  let updatedCommentMsg = null
  let migrationFileListByDirectory = result.migratedFileList

  // Run migrations
  if (result.dryRun === false) {
    const migrationConfigList = result.migrationConfigList.map(migrationConfig => {
      migrationConfig.dryRun = false
      return migrationConfig
    })
    const { errMsg: migrationErrMsg, migratedFileList } = await runMigrationFromList(migrationConfigList)

    if (migrationErrMsg) {
      console.error(migrationErrMsg)
      updatedCommentMsg = commentBuilder('failed', migrationErrMsg)
    }

    migrationFileListByDirectory = migratedFileList
  } else {
    updatedCommentMsg = commentBuilder('successful')
  }

  if (updatedCommentMsg === null) {
    updatedCommentMsg = commentBuilder('successful')
  }

  const fileListForComment = getFileListingForComment(migrationFileListByDirectory)
  updatedCommentMsg = `${updatedCommentMsg}\r\n${fileListForComment}`

  // Update comment and add label
  await Promise.all([
    ghClient.updateComment(commentID, updatedCommentMsg),
    alreadyExists === true
      ? result.jiraClient.addComment(
          jiraIssue.id,
          buildJiraDescription(organization, repoName, prNumber, updatedCommentMsg)
        )
      : Promise.resolve(true),
    result.migrationAvailable === true // && dryRun === false
      ? ghClient.addLabel(prNumber, config.pr_label)
      : Promise.resolve(true)
  ])
}

function getUpdatedComment(
  commentBody: string,
  msgPrefix: string,
  htmlURL: string,
  isJiraEvent = false
): (boldText: string, msg?: string) => string {
  return (boldText, msg) => {
    let returnMsg = `${commentBody}\r\n\r\n**${msgPrefix} ${boldText}** ${dt()} (${buildExecutionMarkdown(
      htmlURL,
      isJiraEvent
    )})`
    if (msg) {
      returnMsg = `${returnMsg}: ${msg}`
    }
    return returnMsg
  }
}

function getFileListingForComment(migrationFileListByDirectory: string[][]): string {
  return migrationFileListByDirectory
    .reduce((acc, fileList, idx) => {
      acc.push(`Directory: '${config.databases[idx].directory}'`)
      if (fileList.length === 0) {
        acc.push(`  Files: NA`)
        return acc
      }
      acc.push(`  Files:`)
      for (const file of fileList) {
        acc.push(`    - ${file}`)
      }
      return acc
    }, [])
    .join('\r\n')
}

export async function run(): Promise<void> {
  const secretKeys = config.databases.reduce(
    (acc, db) => {
      acc.push(db.url_path)
      return acc
    },
    [config.tokens.github, config.tokens.jira_token, config.tokens.jira_user]
  )
  const awsSecrets = await awsClient.getSecrets(config.secret_provider.path, secretKeys)
  console.log(awsSecrets)
  // return;

  if (process.env.SOME_INVALID_ENV_VAR === 'should not BE PRESENT') {
    await processGithubEvent1(eventData, awsSecrets)
  }
  try {
    await dataDumper(eventData)
  } catch (ex) {
    console.error(ex)
  }
}
