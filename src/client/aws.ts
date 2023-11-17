import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getInput } from '../util'

export type AWSSecrets = Record<string, string>

class Client {
  #secretManager: SecretsManagerClient

  constructor(accessKeyId?: string, secretAccessKey?: string, region?: string, endpointURL?: string) {
    accessKeyId = accessKeyId || getInput('aws_access_key_id', '')
    secretAccessKey = secretAccessKey || getInput('aws_access_key_secret', '')
    region = region || getInput('aws_region', 'ap-south-1')
    endpointURL = endpointURL || getInput('aws_endpoint_url', '')

    let credentials
    if (accessKeyId && secretAccessKey) {
      credentials = { accessKeyId, secretAccessKey }
    }

    const clientArgs = {
      credentials,
      endpoint: endpointURL,
      region
    }

    this.#secretManager = new SecretsManagerClient(clientArgs)
  }

  /**
   *
   * @param {string} secretId
   * @param {string[]} keyNames
   * @returns
   */
  async getSecrets(secretId: string, keyNames?: string[]): Promise<AWSSecrets> {
    const command = new GetSecretValueCommand({
      SecretId: secretId
    })

    const secretString = (await this.#secretManager.send(command)).SecretString
    if (!secretString) {
      throw new Error(`Secret doesn't exist for secret ${secretId}`)
    }
    const secretMap = JSON.parse(secretString)

    if (!keyNames) {
      return secretMap
    }
    return keyNames.reduce((acc: Record<string, string>, key) => {
      acc[key] = secretMap[key]
      return acc
    }, {})
  }
}

export default Client
