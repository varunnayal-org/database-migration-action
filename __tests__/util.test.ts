import * as core from '@actions/core'
import * as util from '../src/util'
import path from 'path'

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

  describe('globFromList', () => {
    function run(dirList: string[], expectedResult: string[][], expectedUnmatchedFiles: string[] = []): void {
      const changedFiles = [
        ...expectedResult.reduce((acc, files) => [...acc, ...files], [...expectedUnmatchedFiles])
      ].sort(
        // randomize the order
        () => Math.random() - 0.5
      )
      const glob = util.globFromList(dirList, changedFiles)

      glob.matched = glob.matched.map(files => files.sort())
      glob.unmatched = glob.unmatched.sort()

      expect(glob).toEqual({
        matched: expectedResult.map(files => files.sort()),
        unmatched: expectedUnmatchedFiles.sort()
      })
    }

    function getFiles(dir: string, files: string[] = ['test1.sql', 'test2.sql', 'atlas.hcl', 'atlas.sum']): string[] {
      return files
        .map(file => path.join(dir, file))
        .sort(
          // randomize the order
          () => Math.random() - 0.5
        )
    }

    describe('single migration directory', () => {
      // eslint-disable-next-line jest/expect-expect
      it('should return matched files', () => {
        const expectedResult = [getFiles('migrations')]

        run(['migrations'], expectedResult)
      })

      // eslint-disable-next-line jest/expect-expect
      it('should return matched and unmatched files', () => {
        const expectedResult = [getFiles('migrations')]
        const expectedUnmatchedFiles = [
          'migration/a.sql',
          'atlas.hcl',
          'db.migration.json',
          '.github/workflows/db-schema-migration.yml'
        ]

        run(['migrations'], expectedResult, expectedUnmatchedFiles)
      })

      // eslint-disable-next-line jest/expect-expect
      it('should return unmatched files', () => {
        const expectedResult = [[]]

        const expectedUnmatchedFiles = [
          ...getFiles('migrations/db1'),

          // other
          'migration/a.sql',
          'atlas.hcl',
          'db.migration.json',
          '.github/workflows/db-schema-migration.yml',
          'migrations/db3/test1.sql',
          'migrations/test1.sql'
        ]
        run(['migrations/db2'], expectedResult, expectedUnmatchedFiles)
        run(['a/migrations/db2'], expectedResult, expectedUnmatchedFiles)
        run(['abc'], expectedResult, expectedUnmatchedFiles)
      })
    })

    describe('multiple migration directory', () => {
      // eslint-disable-next-line jest/expect-expect
      it('should return matched files', () => {
        const expectedResult = [getFiles('migrations/db1'), getFiles('migrations/db2')]
        const expectedUnmatchedFiles = [
          'migration/a.sql',
          'atlas.hcl',
          'db.migration.json',
          '.github/workflows/db-schema-migration.yml',
          'migrations/db3/test1.sql',
          'migrations/test1.sql'
        ]
        run(['migrations/db1', 'migrations/db2'], expectedResult, expectedUnmatchedFiles)
        run(['migrations/db2', 'migrations/db1'], [expectedResult[1], expectedResult[0]], expectedUnmatchedFiles)
      })

      // eslint-disable-next-line jest/expect-expect
      it('should return matched and unmatched files', () => {
        const expectedResult = [getFiles('migrations/db1'), getFiles('migrations/db2')]

        const expectedUnmatchedFiles = [
          'migration/a.sql',
          'atlas.hcl',
          'db.migration.json',
          '.github/workflows/db-schema-migration.yml',
          'migrations/db3/test1.sql',
          'migrations/test1.sql'
        ]
        run(['migrations/db1', 'migrations/db2'], expectedResult, expectedUnmatchedFiles)
        run(['migrations/db2', 'migrations/db1'], [expectedResult[1], expectedResult[0]], expectedUnmatchedFiles)
      })

      // eslint-disable-next-line jest/expect-expect
      it('should return unmatched files', () => {
        const expectedResult = [[], []]

        const expectedUnmatchedFiles = [
          // migrations/db1
          ...getFiles('migrations/db1'),
          // migrations/db2
          ...getFiles('migrations/db2'),

          // other
          'migration/a.sql',
          'atlas.hcl',
          'db.migration.json',
          '.github/workflows/db-schema-migration.yml',
          'migrations/db3/test1.sql',
          'migrations/test1.sql'
        ]
        run(['migrations/db4', 'migrations/db5'], expectedResult, expectedUnmatchedFiles)
        run(['migrations/db4', 'abc', 'data'], [[], [], []], expectedUnmatchedFiles)
      })

      // eslint-disable-next-line jest/expect-expect
      it('should return match prefix', () => {
        const expectedResult = [
          [
            // migrations/db1
            ...getFiles('migrations/db1'),
            // migrations/db2
            ...getFiles('migrations/db2')
          ]
        ]

        const expectedUnmatchedFiles = [
          // other
          'migration/a.sql',
          'atlas.hcl',
          'db.migration.json',
          '.github/workflows/db-schema-migration.yml',
          'migrations/test1.sql'
        ]

        run(['migrations/db'], expectedResult, expectedUnmatchedFiles)
      })
    })
  })

  describe('executeWithRetry', () => {
    let mock: jest.Mock
    let callNum: number
    function setupMock(numOfErrors = 0): void {
      callNum = 1
      mock = jest.fn().mockImplementation(() => {
        if (numOfErrors >= 1 && callNum <= numOfErrors) {
          throw new Error(`Err: ${callNum++}`)
        }
        return callNum++
      })
    }
    beforeEach(() => {
      jest.clearAllMocks()
      setupMock(0) // do not throw error
    })
    it('should execute successfully', () => {
      util.executeWithRetry(mock, 'test')
      expect(mock).toHaveBeenCalledTimes(1)
    })

    it('should execute successfully after retry', () => {
      const maxRetry = 4
      const maxErrThrow = 2
      setupMock(maxErrThrow)
      util.executeWithRetry(() => mock(callNum), 'test', maxRetry, 2, 4)

      expect(mock).toHaveBeenCalledTimes(maxErrThrow + 1) // extra for successful call
      expect(mock).toHaveBeenNthCalledWith(1, 1)
      expect(mock).toHaveBeenNthCalledWith(2, 2)
      expect(mock).toHaveBeenNthCalledWith(3, 3)
    })

    it('should error after retry', async () => {
      const maxRetry = 3
      setupMock(3)
      await expect(async () => util.executeWithRetry(() => mock(callNum), 'test', maxRetry, 2, 4)).rejects.toThrow(
        'Err: 1'
      )
      expect(mock).toHaveBeenCalledTimes(maxRetry)
      expect(mock).toHaveBeenNthCalledWith(1, 1)
      expect(mock).toHaveBeenNthCalledWith(2, 2)
      expect(mock).toHaveBeenNthCalledWith(3, 3)
    })
  })
})
