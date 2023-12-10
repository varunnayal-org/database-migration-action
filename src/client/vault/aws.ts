import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { VaultClient, SecretMap } from './types'

export default class AWSClient implements VaultClient {
  #secretManager: SecretsManagerClient
  #secretStore: string

  constructor(secretManager: SecretsManagerClient, secretStore: string) {
    this.#secretManager = secretManager
    this.#secretStore = secretStore
  }

  async getSecrets(keyNames: string[]): Promise<SecretMap> {
    const command = new GetSecretValueCommand({
      SecretId: this.#secretStore
    })

    const secretString = (await this.#secretManager.send(command)).SecretString
    if (!secretString) {
      throw new Error(`Secret doesn't exist for secret ${this.#secretStore}`)
    }
    const secretMap = JSON.parse(secretString)

    return keyNames.reduce((acc: Record<string, string>, key) => {
      acc[key] = secretMap[key]
      return acc
    }, {})
  }
}
