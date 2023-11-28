import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getInput } from '../util'

export type SecretMap = Record<string, string>

export default class Client {
  #secretManager: SecretsManagerClient
  #secretStore: string

  constructor(region = process.env.AWS_REGION) {
    this.#secretManager = new SecretsManagerClient({
      region: region || 'ap-south-1'
    })
    this.#secretStore = getInput('aws_secret_store')
  }

  /**
   *
   * @param {string[]} keyNames
   * @returns
   */
  async getSecrets(keyNames?: string[]): Promise<SecretMap> {
    const command = new GetSecretValueCommand({
      SecretId: this.#secretStore
    })

    console.log(await this.#secretManager.send(command))
    const secretString = (await this.#secretManager.send(command)).SecretString
    if (!secretString) {
      throw new Error(`Secret doesn't exist for secret ${this.#secretStore}`)
    }
    const secretMap = JSON.parse(secretString)

    if (keyNames == null) {
      return secretMap
    }
    return keyNames.reduce((acc: Record<string, string>, key) => {
      acc[key] = secretMap[key]
      return acc
    }, {})
  }
}
