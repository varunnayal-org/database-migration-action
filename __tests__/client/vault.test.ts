import * as core from '@actions/core'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

import AWSClient from '../../src/client/vault/aws'
import factory from '../../src/factory'

let getInputMock: jest.SpyInstance
let smSend: jest.SpyInstance

describe('vault', () => {
  describe('AWSClient', function () {
    const sm = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'ap-south-1'
    })
    const client = new AWSClient(sm, 'secret-store')
    beforeEach(() => {
      jest.clearAllMocks()
      smSend = jest.spyOn(sm, 'send').mockImplementation()
    })

    it('get_secret', async () => {
      const smSendFn = smSend.mockReturnValue(Promise.resolve({ SecretString: '{"key1": "value1", "key2": "value2"}' }))

      const response = await client.getSecrets(['key1'])
      expect(response).toEqual({ key1: 'value1' })
      expect(smSendFn).toHaveBeenCalledTimes(1)
    })

    it("throws error if secret doesn't exist", async () => {
      const smSendFn = smSend.mockReturnValue(Promise.resolve({ SecretString: '' }))

      await expect(client.getSecrets(['key1'])).rejects.toThrow("Secret doesn't exist for secret secret-store")
      expect(smSendFn).toHaveBeenCalledTimes(1)
    })

    it('throws error secret string is not JSON', async () => {
      const smSendFn = smSend.mockReturnValue(Promise.resolve({ SecretString: 'not-json' }))

      await expect(client.getSecrets(['key1'])).rejects.toThrow(`Unexpected token 'o', "not-json" is not valid JSON`)
      expect(smSendFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('factory', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    })

    // Write test cases for getVault() method
    it('return aws secret manager', () => {
      const mock = getInputMock.mockReturnValue('secret-store-arn')

      const client = factory.getVault()

      expect(client).toBeInstanceOf(AWSClient)
      expect(mock).toHaveBeenCalledTimes(1)
    })

    it('throw error if no vault configured', () => {
      const mock = getInputMock.mockReturnValue('')

      expect(() => factory.getVault()).toThrow('No vault configured')
      expect(mock).toHaveBeenCalledTimes(1)
    })
  })
})
