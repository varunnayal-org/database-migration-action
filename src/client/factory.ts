import * as core from '@actions/core'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { VaultClient } from './vault/types'
import AWSClient from './vault/aws'

/**
 * Returns a hydrated vault client ready to use for GitHub Actions.
 * If an AWS secret store is configured, it creates an AWSClient using the SecretsManagerClient
 * from the AWS SDK and the specified secret store. Otherwise, it throws an error.
 *
 * @returns A vault client.
 * @throws {Error} If no vault is configured.
 */
export function getVaultManager(): VaultClient {
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
