import * as github from '@actions/github'
import GHClient from './client/github'
import AWSClient from './client/aws'
import MigrationService from './migration.service'
import buildConfig from './config'
import { dataDumper } from './debug'
import * as gha from './types.gha'

export async function run(): Promise<void> {
  const config = buildConfig()
  const ghClient = GHClient.fromEnv()
  const awsClient = new AWSClient()
  const migrator = new MigrationService(config, ghClient, awsClient)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = github.context as any as gha.Context
  const { eventName } = event

  let process = false
  if (eventName === 'issue_comment') {
    process = true
    ghClient.setOrg(
      event.payload.organization.login,
      event.payload.repository.owner.login,
      event.payload.repository.name
    )

    config.baseBranch = event.payload.repository.default_branch
    await migrator.mapIssueToPullRequest(event.payload.issue)
  }

  if (eventName === 'pull_request_review' || eventName === 'pull_request') {
    process = true
    ghClient.setOrg(
      event.payload.organization.login,
      event.payload.pull_request.base.repo.owner.login,
      event.payload.pull_request.base.repo.name
    )
  }

  config.baseBranch = event.payload.repository.default_branch

  console.debug(
    `Event: ${eventName}, Action: ${event.payload.action} on baseBranch=${config.baseBranch}, canProcess=${process}`
  )

  if (process) {
    const response = await Promise.allSettled([migrator.processEvent(event), dataDumper()])
    if (response[0].status === 'rejected') {
      throw response[0].reason
    }
  }
}
