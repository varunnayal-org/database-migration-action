// eslint-disable-next-line import/no-unresolved
import { OctokitOptions } from '@octokit/core/dist-types/types'
import * as github from '@actions/github'
import * as core from '@actions/core'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import JiraApi from 'jira-client'

import { VaultClient } from './client/vault/types'
import AWSClient from './client/vault/aws'
import GithubAPI from './client/github'
import { GHClient, GithubClient } from './types.gha'
import Jira from './client/jira'
import { Config as JiraConfig, JiraClient } from './types.jira'
import { Builder, Config, Notifier } from './types'
import { getInput } from './util'
import { NotifierService } from './notifier.service'

class Factory implements Builder {
  getVault(): VaultClient {
    const secretStore = core.getInput('aws_secret_store', { required: false })
    if (secretStore) {
      return new AWSClient(
        new SecretsManagerClient({
          region: process.env.AWS_REGION || 'ap-south-1'
        }),
        secretStore
      )
    }
    throw new Error('No vault configured')
  }

  getJira(config?: JiraConfig): JiraClient | null {
    if (config) {
      const username = getInput('jira_username', 'na')
      if (username === 'na') {
        throw new Error('Jira config missing username')
      }
      const password = getInput('jira_password', 'na')
      if (password === 'na') {
        throw new Error('Jira config missing password')
      }

      return new Jira(
        new JiraApi({
          protocol: 'https',
          host: config.host,
          username,
          password,
          apiVersion: '2',
          strictSSL: true
        }),
        config
      )
    }
    return null
  }

  #buildOctokit(token: string, opts: OctokitOptions = {}): GithubClient {
    const debugStr = getInput('debug', 'false').toLowerCase()
    return github.getOctokit(token, {
      debug: debugStr === 'true' || debugStr === '1',
      ...opts
    })
  }

  getGithub(opts?: OctokitOptions): GHClient {
    return new GithubAPI(this.#buildOctokit(getInput('repo_token'), opts))
  }

  getNotifier(dryRun: boolean, config: Config, ghClient: GHClient, jiraClient: JiraClient | null): Notifier {
    return new NotifierService(dryRun, config, ghClient, jiraClient)
  }
}

const factory: Builder = new Factory()

export default factory
