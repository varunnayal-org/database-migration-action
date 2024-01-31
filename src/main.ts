import * as core from '@actions/core'

import MigrationService from './migration.service'
import buildConfig from './config'
import { dataDumper } from './echo_state'
import factory from './factory'
import * as util from './util'

export async function run(): Promise<void> {
  const config = buildConfig()
  const migrator = new MigrationService(config, factory)

  const event = util.getContext()
  const { eventName } = event

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let responsePromise: Promise<any> | undefined
  if (eventName === 'schedule') {
    responsePromise = migrator.processDrift(event)
  } else {
    let process = false
    if (eventName === 'issue_comment') {
      process = true
      migrator.init(
        event.payload.organization.login,
        event.payload.repository.owner.login,
        event.payload.repository.name
      )

      await migrator.mapIssueToPullRequest(event.payload.issue)
    } else if (eventName === 'pull_request_review' || eventName === 'pull_request') {
      process = true
      migrator.init(
        event.payload.organization.login,
        event.payload.pull_request.base.repo.owner.login,
        event.payload.pull_request.base.repo.name
      )
    }

    if (process) {
      config.baseBranch = event.payload.repository.default_branch

      core.info(
        `Event: ${eventName}, Action: ${event.payload.action} on baseBranch=${config.baseBranch}, canProcess=${process}`
      )
      responsePromise = migrator.processEvent(event)
    }
  }

  if (responsePromise) {
    const response = await Promise.allSettled([responsePromise, dataDumper()])
    if (response[0].status === 'rejected') {
      throw response[0].reason
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrator.skipProcessingHandler(eventName, (event.payload as any) || { action: 'na' })
  }
}
