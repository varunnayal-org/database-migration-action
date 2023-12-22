import mock from 'mock-fs'
import fs from 'fs/promises'
import path from 'path'

import * as atlas from '../../src/migration/atlas'
import * as migration from '../../src/migration/migration'
import { MigrationConfig, MigrationRunListResponse } from '../../src/types'
import { SecretMap } from '../../src/client/vault/types'
import { DatabaseConfig } from '../../src/config'
import { AtlasMigrationExecutionResponse } from '../../src/migration/atlas-class'
import * as c from '../common'
import { TEMP_DIR_FOR_MIGRATION } from '../../src/constants'

let atlasRun: jest.SpyInstance

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getMockDirectories = (): Record<string, any> => ({
  [`${TEMP_DIR_FOR_MIGRATION}`]: mock.directory(),
  migrations: {
    'readme.md': '# Readme',
    'other_file.txt': 'test file',
    '00000000000001_create_test_table.sql': 'create table test(id int);',
    '00000000000002_create_test2_table.sql': 'create table test2(id int);'
  },
  multi_db_dir: {
    db1: {
      'atlas.hcl': 'lint { }',
      'readme_db1.md': '# Readme',
      '00000000000005_create_test5_table.sql': 'create table test5(id int);',
      '00000000000006_create_test6_table.sql': 'create table test6(id int);'
    },
    db2: {
      'atlas.hcl': 'lint { }',
      'readme_db2.md': '# Readme',
      '00000000000007_create_test7_table.sql': 'create table tes7(id int);',
      '00000000000008_create_test8_table.sql': 'create table test8(id int);',
      '00000000000009_create_test9_table.sql': 'create table test9(id int);'
    },
    db3: {
      'atlas.hcl': 'lint { }',
      'readme_db3.md': '# Readme',
      '00000000000010_create_test10_table.sql': 'create table tes10(id int);',
      '00000000000011_create_test11_table.sql': 'create table test11(id int);',
      '00000000000012_create_test12_table.sql': 'create table test12(id int);'
    }
  }
})

const getDB = (directory = '.', envName = 'test', schema = 'public'): DatabaseConfig => ({
  directory,
  envName,
  schema
})

const getVaultKeyStore = (...names: string[]): SecretMap =>
  names.length === 0 ? { test: 'test' } : names.reduce((acc, name) => ({ ...acc, [name]: name }), {})
const getExpectedMigrationConfigList = (
  dir = '.',
  databaseUrl = 'test',
  baseDir = 'migrations',
  schema = 'public',
  devUrl = 'test'
): MigrationConfig[] => [
  {
    dir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
    originalDir: path.join(baseDir, dir),
    relativeDir: path.join(baseDir, dir),
    databaseUrl,
    schema,
    baseline: undefined,
    dryRun: true,
    devUrl
  }
]

describe('buildMigrationConfigList', () => {
  const devDBUrl = 'test'
  beforeEach(() => {
    jest.clearAllMocks()
    mock.restore()
    mock(getMockDirectories())
  })

  afterEach(() => {
    mock.restore()
  })

  describe('single_database', () => {
    it('should return migration config list', async () => {
      expect(await migration.buildMigrationConfigList('migrations', [getDB()], devDBUrl, getVaultKeyStore())).toEqual(
        getExpectedMigrationConfigList()
      )
    })

    it('should ignore non sql files', async () => {
      expect(await migration.buildMigrationConfigList('migrations', [getDB()], devDBUrl, getVaultKeyStore())).toEqual(
        getExpectedMigrationConfigList()
      )

      expect(await fs.readdir(TEMP_DIR_FOR_MIGRATION)).toEqual([
        '00000000000001_create_test_table.sql',
        '00000000000002_create_test2_table.sql',
        'atlas.hcl'
      ])
    })

    it('should throw error if secret not found', async () => {
      await expect(
        migration.buildMigrationConfigList('migrations', [getDB()], devDBUrl, getVaultKeyStore('test1'))
      ).rejects.toThrow('Secret test not found')
    })

    it('should set dry run to passed value', async () => {
      const migrationConfigList = [
        ...getExpectedMigrationConfigList(),
        ...getExpectedMigrationConfigList('dir2', 'key2')
      ]

      expect(migrationConfigList.every(config => config.dryRun === true)).toBe(true)
      migration.setDryRun(migrationConfigList, false)
      expect(migrationConfigList.every(config => config.dryRun === false)).toBe(true)
    })
  })

  describe('multiple_databases', () => {
    let dbs: DatabaseConfig[]
    let expectedMigrationConfigList: MigrationConfig[]
    let vaultKeyStore: SecretMap
    beforeEach(async () => {
      dbs = [getDB('db1', 'db1_key'), getDB('db2', 'db2_key')]
      expectedMigrationConfigList = [
        ...getExpectedMigrationConfigList('db1', 'db1_credentials', 'multi_db_dir'),
        ...getExpectedMigrationConfigList('db2', 'db2_credentials', 'multi_db_dir')
      ]
      vaultKeyStore = {
        db1_key: 'db1_credentials',
        db2_key: 'db2_credentials'
      }
    })

    it('should return migration config list', async () => {
      expect(await migration.buildMigrationConfigList('multi_db_dir', dbs, devDBUrl, vaultKeyStore)).toEqual(
        expectedMigrationConfigList
      )
    })

    it('should ignore non sql files', async () => {
      expect(await migration.buildMigrationConfigList('multi_db_dir', dbs, devDBUrl, vaultKeyStore)).toEqual(
        expectedMigrationConfigList
      )

      expect(await fs.readdir(expectedMigrationConfigList[0].dir)).toEqual([
        '00000000000005_create_test5_table.sql',
        '00000000000006_create_test6_table.sql',
        'atlas.hcl'
      ])

      expect(await fs.readdir(expectedMigrationConfigList[1].dir)).toEqual([
        '00000000000007_create_test7_table.sql',
        '00000000000008_create_test8_table.sql',
        '00000000000009_create_test9_table.sql',
        'atlas.hcl'
      ])
    })

    it('should throw error if secret not found', async () => {
      await expect(
        migration.buildMigrationConfigList('multi_db_dir', dbs, devDBUrl, {
          ...vaultKeyStore,
          db2_key: ''
        })
      ).rejects.toThrow('Secret db2_key not found')
    })

    it('should set dry run to passed value', async () => {
      expect(expectedMigrationConfigList.every(config => config.dryRun === true)).toBe(true)
      migration.setDryRun(expectedMigrationConfigList, false)
      expect(expectedMigrationConfigList.every(config => config.dryRun === false)).toBe(true)
    })
  })
})

describe('runMigrationFromList', () => {
  const getAtlasSuccessfulRunResponse = (): AtlasMigrationExecutionResponse =>
    AtlasMigrationExecutionResponse.build(c.executionListForDB1)
  const getAtlasRunResponseForNull = AtlasMigrationExecutionResponse.build('null')
  const getAtlasRunResponseForEmptyString = AtlasMigrationExecutionResponse.build('')

  beforeEach(() => {
    jest.clearAllMocks()
    atlasRun = jest.spyOn(atlas, 'run').mockImplementation()
  })

  describe('single_database', () => {
    it('should return no migration available', async () => {
      const migrationConfigList = getExpectedMigrationConfigList()
      const atlasRunFn = atlasRun.mockResolvedValue(getAtlasRunResponseForEmptyString)

      const response = await migration.runMigrationFromList(migrationConfigList, true)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: false,
        executionResponseList: [getAtlasRunResponseForNull]
      }

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(1)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...migrationConfigList[0],
        dryRun: true
      })
    })

    it('should return response', async () => {
      const migrationConfigList = getExpectedMigrationConfigList()

      const atlasRunFn = atlasRun.mockResolvedValue(getAtlasSuccessfulRunResponse())

      const response = await migration.runMigrationFromList(migrationConfigList, true)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: true,
        executionResponseList: [getAtlasSuccessfulRunResponse()]
      }
      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(1)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...migrationConfigList[0],
        dryRun: true
      })
    })
  })

  describe('multiple_databases', () => {
    let expectedMigrationConfigList: MigrationConfig[]
    let migrationConfigList: MigrationConfig[]
    beforeEach(async () => {
      expectedMigrationConfigList = [
        ...getExpectedMigrationConfigList('db1', 'db1_credentials', 'multi_db_dir'),
        ...getExpectedMigrationConfigList('db2', 'db2_credentials', 'multi_db_dir'),
        ...getExpectedMigrationConfigList('db3', 'db3_credentials', 'multi_db_dir')
      ]
      migrationConfigList = [
        ...getExpectedMigrationConfigList('db1', 'db1_credentials', 'multi_db_dir'),
        ...getExpectedMigrationConfigList('db2', 'db2_credentials', 'multi_db_dir'),
        ...getExpectedMigrationConfigList('db3', 'db3_credentials', 'multi_db_dir')
      ]
    })

    it('should return no migration available', async () => {
      const atlasRunFn = atlasRun.mockResolvedValue(getAtlasRunResponseForEmptyString)
      const dryRun = false

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: false,
        executionResponseList: [
          getAtlasRunResponseForNull,
          getAtlasRunResponseForEmptyString,
          getAtlasRunResponseForEmptyString
        ]
      }

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(expectedMigrationConfigList.length)
      for (const migrationConfig of expectedMigrationConfigList) {
        expect(atlasRunFn).toHaveBeenCalledWith({
          ...migrationConfig,
          dryRun
        })
      }
    })

    it('should return response', async () => {
      const dryRun = true
      let atlasRunFnCallCount = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (migrationConfig: MigrationConfig) => {
        ++atlasRunFnCallCount
        if (atlasRunFnCallCount === 1) {
          return getAtlasSuccessfulRunResponse()
        } else if (atlasRunFnCallCount === 2) {
          return AtlasMigrationExecutionResponse.build(c.executionListForDB2)
        } else if (atlasRunFnCallCount === 3) {
          return AtlasMigrationExecutionResponse.build(c.executionListForDB3)
        }
      })

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: true,
        executionResponseList: [
          getAtlasSuccessfulRunResponse(),
          AtlasMigrationExecutionResponse.build(c.executionListForDB2),
          AtlasMigrationExecutionResponse.build(c.executionListForDB3)
        ]
      }

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(expectedMigrationConfigList.length)
      for (const migrationConfig of expectedMigrationConfigList) {
        expect(atlasRunFn).toHaveBeenCalledWith({
          ...migrationConfig,
          dryRun
        })
      }
    })

    it('should return response if migration not available for some dbs', async () => {
      const dryRun = false
      let atlasRunFnCallCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (_: MigrationConfig) => {
        if (++atlasRunFnCallCount % 2 === 1) {
          return getAtlasRunResponseForEmptyString // no migration available
        }
        return getAtlasSuccessfulRunResponse()
      })

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: true,
        executionResponseList: [
          getAtlasRunResponseForEmptyString,
          getAtlasSuccessfulRunResponse(),
          getAtlasRunResponseForEmptyString
        ]
      }
      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(expectedMigrationConfigList.length)
      for (const migrationConfig of expectedMigrationConfigList) {
        expect(atlasRunFn).toHaveBeenCalledWith({
          ...migrationConfig,
          dryRun
        })
      }
    })

    it('should return response if atlas throws error for all migrations', async () => {
      const dryRun = false
      let atlasRunFnCallCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (_: MigrationConfig) => {
        atlasRunFnCallCount++
        return AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=${atlasRunFnCallCount}`)
      })

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: false,
        executionResponseList: [
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=1`),
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=2`),
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=3`)
        ],
        errMsg: 'Atlas error for idx=1'
      }

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(expectedMigrationConfigList.length)
      for (const migrationConfig of expectedMigrationConfigList) {
        expect(atlasRunFn).toHaveBeenCalledWith({
          ...migrationConfig,
          dryRun
        })
      }
    })

    it('should return response if atlas throws error for some migrations', async () => {
      const dryRun = false
      let atlasRunFnCallCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (_: MigrationConfig) => {
        if (++atlasRunFnCallCount % 2 === 1) {
          return AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=${atlasRunFnCallCount - 1}`)
        }
        return getAtlasSuccessfulRunResponse()
      })

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=0`),
          getAtlasSuccessfulRunResponse(),
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=2`)
        ],
        errMsg: 'Atlas error for idx=0'
      }

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(expectedMigrationConfigList.length)
      for (const migrationConfig of expectedMigrationConfigList) {
        expect(atlasRunFn).toHaveBeenCalledWith({
          ...migrationConfig,
          dryRun
        })
      }
    })
  })
})
