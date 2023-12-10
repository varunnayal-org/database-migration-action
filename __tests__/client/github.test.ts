import * as core from '@actions/core'
import Client from '../../src/client/github'

let getInputMock: jest.SpyInstance

describe('github client', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
  })

  it('should return github client', () => {
    const getInputMockFn = getInputMock.mockImplementation((name: string) => {
      if (name === 'repo_token') {
        return 'token'
      } else if (name === 'debug') {
        return 'true'
      }
      throw new Error(`Unknown input ${name}`)
    })

    const client = Client.fromEnv()

    expect(client).toBeInstanceOf(Client)
    expect(getInputMockFn).toHaveBeenCalledTimes(2)
  })

  it('should throw error if no token configured', () => {
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'repo_token') {
        return ''
      } else if (name === 'debug') {
        return 'true'
      }
      throw new Error(`Unknown input ${name}`)
    })

    expect(() => Client.fromEnv()).toThrow('Input repo_token is not set')
    expect(getInputMock).toHaveBeenCalledTimes(1)
  })
})
