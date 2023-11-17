import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

export type AWSSecrets = Record<string, string>

class Client {
  #secretManager: SecretsManagerClient

  constructor(
    accessKeyId: string | undefined = process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: string | undefined = process.env.AWS_SECRET_ACCESS_KEY,
    endpointURL: string | undefined = process.env.AWS_ENDPOINT_URL,
    region: string = process.env.AWS_REGION || 'ap-south-1'
  ) {
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
