import * as core from '@actions/core'
import * as util from '../src/util'

describe('util', () => {
  describe('getEnv', () => {
    it('should return env', () => {
      process.env.RANDOM_ENV = 'test'
      const env = util.getEnv('RANDOM_ENV')
      expect(env).toEqual('test')
      delete process.env.RANDOM_ENV
    })

    it('should return default env', () => {
      const env = util.getEnv('CUSTOM_MAP', { CUSTOM_MAP: 'test' })
      expect(env).toEqual('test')
    })

    it('should throw error if env is not set', () => {
      expect(() => util.getEnv('test')).toThrow('Environment variable test is not set')
    })
  })

  describe('getInput', () => {
    let getInputMock: jest.SpyInstance
    beforeEach(() => {
      jest.clearAllMocks()
      getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    })

    it('should return input', () => {
      getInputMock.mockReturnValue('test')
      const input = util.getInput('test')
      expect(input).toEqual('test')
      expect(getInputMock).toHaveBeenCalledTimes(1)
    })

    it('should return default input', () => {
      getInputMock.mockReturnValue('')
      const input = util.getInput('test', 'default')
      expect(input).toEqual('default')
      expect(getInputMock).toHaveBeenCalledTimes(1)
    })

    it('should throw error if input is not set', () => {
      getInputMock.mockReturnValue('')
      expect(() => util.getInput('test')).toThrow('Input test is not set')
      expect(getInputMock).toHaveBeenCalledTimes(1)
    })
  })
})
