import mock from 'mock-fs'
import fs from 'fs/promises'
import path from 'path'

import * as atlas from '../../src/migration/atlas'
import * as migration from '../../src/migration/migration'
import { MigrationConfig, MigrationRunListResponse } from '../../src/types'
import { SecretMap } from '../../src/client/vault/types'
import { DatabaseConfig } from '../../src/config'
import { AtlasMigrationExecutionResponse, VersionExecution } from '../../src/migration/atlas-class'

let atlasRun: jest.SpyInstance

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getMockDirectories = (): Record<string, any> => ({
  [`${migration.TEMP_DIR_FOR_MIGRATION}`]: mock.directory(),
  migrations: {
    'readme.md': '# Readme',
    'other_file.txt': 'test file',
    '00000000000001_create_test_table.sql': 'create table test(id int);',
    '00000000000002_create_test2_table.sql': 'create table test2(id int);'
  },
  multi_db_dir: {
    db1: {
      'readme_db1.md': '# Readme',
      '00000000000005_create_test5_table.sql': 'create table test5(id int);',
      '00000000000006_create_test6_table.sql': 'create table test6(id int);'
    },
    db2: {
      'readme_db2.md': '# Readme',
      '00000000000007_create_test7_table.sql': 'create table tes7(id int);',
      '00000000000008_create_test8_table.sql': 'create table test8(id int);',
      '00000000000009_create_test9_table.sql': 'create table test9(id int);'
    }
  }
})

function getBaseExecutionList(): VersionExecution[] {
  return [
    {
      Name: '20231129060014_add_user.sql',
      Version: '20231129060014',
      Description: 'add_user',
      Start: '2023-12-11T10:55:19.468908+05:30',
      End: '2023-12-11T10:55:19.470647+05:30',
      Applied: [
        'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
        'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
      ]
    },
    {
      Name: '20231206212844_add_column.sql',
      Version: '20231206212844',
      Description: 'add_column',
      Start: '2023-12-11T10:55:19.470647+05:30',
      End: '2023-12-11T10:55:19.470648+05:30',
      Applied: ['ALTER TABLE "users" ADD COLUMN "email" varchar(255);']
    }
  ]
}

const getDB = (directory = '.', envName = 'test', schema = 'public'): DatabaseConfig => ({
  directory,
  envName,
  schema
})
const getVaultKeyStore = (...names: string[]): SecretMap =>
  names.length === 0 ? { test: 'test' } : names.reduce((acc, name) => ({ ...acc, [name]: name }), {})
const getExpectedMigrationConfigList = (dir = '.', databaseUrl = 'test', schema = 'public'): MigrationConfig[] => [
  {
    dir: path.join(migration.TEMP_DIR_FOR_MIGRATION, dir),
    databaseUrl,
    schema,
    baseline: undefined,
    dryRun: true
  }
]

class MyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    this.stack = ''
  }
}

describe('buildMigrationConfigList', () => {
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
      expect(await migration.buildMigrationConfigList('migrations', [getDB()], getVaultKeyStore())).toEqual(
        getExpectedMigrationConfigList()
      )
    })

    it('should ignore non sql files', async () => {
      expect(await migration.buildMigrationConfigList('migrations', [getDB()], getVaultKeyStore())).toEqual(
        getExpectedMigrationConfigList()
      )

      expect(await fs.readdir(migration.TEMP_DIR_FOR_MIGRATION)).toEqual([
        '00000000000001_create_test_table.sql',
        '00000000000002_create_test2_table.sql'
      ])
    })

    it('should throw error if secret not found', async () => {
      await expect(
        migration.buildMigrationConfigList('migrations', [getDB()], getVaultKeyStore('test1'))
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
        ...getExpectedMigrationConfigList('db1', 'db1_credentials'),
        ...getExpectedMigrationConfigList('db2', 'db2_credentials')
      ]
      vaultKeyStore = {
        db1_key: 'db1_credentials',
        db2_key: 'db2_credentials'
      }
    })

    it('should return migration config list', async () => {
      expect(await migration.buildMigrationConfigList('multi_db_dir', dbs, vaultKeyStore)).toEqual(
        expectedMigrationConfigList
      )
    })

    it('should ignore non sql files', async () => {
      expect(await migration.buildMigrationConfigList('multi_db_dir', dbs, vaultKeyStore)).toEqual(
        expectedMigrationConfigList
      )

      expect(await fs.readdir(expectedMigrationConfigList[0].dir)).toEqual([
        '00000000000005_create_test5_table.sql',
        '00000000000006_create_test6_table.sql'
      ])

      expect(await fs.readdir(expectedMigrationConfigList[1].dir)).toEqual([
        '00000000000007_create_test7_table.sql',
        '00000000000008_create_test8_table.sql',
        '00000000000009_create_test9_table.sql'
      ])
    })

    it('should throw error if secret not found', async () => {
      await expect(
        migration.buildMigrationConfigList('multi_db_dir', dbs, {
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
  const getAtlasSuccessfulRunResponseString = (): string => JSON.stringify(getBaseExecutionList())
  const getAtlasSuccessfulRunResponse = (): AtlasMigrationExecutionResponse =>
    AtlasMigrationExecutionResponse.fromResponse(getAtlasSuccessfulRunResponseString())
  const getAtlasRunResponseForNull = AtlasMigrationExecutionResponse.fromResponse('null')
  const getAtlasRunResponseForEmptyString = AtlasMigrationExecutionResponse.fromResponse('')

  function getBaseExecutionListForDB2(): VersionExecution[] {
    return [
      {
        Name: '20231221010101_add_session.sql',
        Version: '20231221010101',
        Description: 'add_session',
        Start: '2023-12-11T10:55:19.468908+05:30',
        End: '2023-12-11T10:55:19.470647+05:30',
        Applied: [
          'CREATE TABLE session (id uuid NOT NULL, PRIMARY KEY ("id"));',
          'ALTER TABLE "session" ADD COLUMN "phone" varchar(13);'
        ]
      },
      {
        Name: '20231207000000_add_column.sql',
        Version: '20231207000000',
        Description: 'add_column',
        Start: '2023-12-11T10:55:19.470647+05:30',
        End: '2023-12-11T10:55:19.470648+05:30',
        Applied: ['ALTER TABLE "session" ADD COLUMN "email" varchar(255);']
      }
    ]
  }

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
        ...getExpectedMigrationConfigList('db1', 'db1_credentials'),
        ...getExpectedMigrationConfigList('db2', 'db2_credentials')
      ]
      migrationConfigList = [
        ...getExpectedMigrationConfigList('db1', 'db1_credentials'),
        ...getExpectedMigrationConfigList('db2', 'db2_credentials')
      ]
    })

    it('should return no migration available', async () => {
      const atlasRunFn = atlasRun.mockResolvedValue(getAtlasRunResponseForEmptyString)
      const dryRun = false

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: false,
        executionResponseList: [getAtlasRunResponseForNull, getAtlasRunResponseForEmptyString]
      }
      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(2)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...expectedMigrationConfigList[0],
        dryRun
      })
      expect(atlasRunFn).toHaveBeenNthCalledWith(2, {
        ...expectedMigrationConfigList[1],
        dryRun
      })
    })

    it('should return response', async () => {
      const dryRun = true
      let calledNum = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (migrationConfig: MigrationConfig) => {
        if (calledNum++ === 0) {
          return getAtlasSuccessfulRunResponse()
        }
        return AtlasMigrationExecutionResponse.fromResponse(JSON.stringify(getBaseExecutionListForDB2()))
      })

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: true,
        executionResponseList: [
          getAtlasSuccessfulRunResponse(),
          AtlasMigrationExecutionResponse.fromResponse(JSON.stringify(getBaseExecutionListForDB2()))
        ]
      }
      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(2)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...expectedMigrationConfigList[0],
        dryRun
      })
      expect(atlasRunFn).toHaveBeenNthCalledWith(2, {
        ...expectedMigrationConfigList[1],
        dryRun
      })
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
        executionResponseList: [getAtlasRunResponseForEmptyString, getAtlasSuccessfulRunResponse()]
      }
      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(2)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...expectedMigrationConfigList[0],
        dryRun
      })
      expect(atlasRunFn).toHaveBeenNthCalledWith(2, {
        ...expectedMigrationConfigList[1],
        dryRun
      })
    })

    it('should return response if atlas throws error for all migrations', async () => {
      const dryRun = false
      let atlasRunFnCallCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (_: MigrationConfig) => {
        return Promise.reject(new MyError(`Atlas error for idx=${atlasRunFnCallCount++}`))
      })

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: false,
        executionResponseList: [
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=0`),
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=1`)
        ],
        errMsg: 'Atlas error for idx=0'
      }

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(2)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...expectedMigrationConfigList[0],
        dryRun
      })
      expect(atlasRunFn).toHaveBeenNthCalledWith(2, {
        ...expectedMigrationConfigList[1],
        dryRun
      })
    })

    it('should return response if atlas throws error for some migrations', async () => {
      const dryRun = false
      let atlasRunFnCallCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const atlasRunFn = atlasRun.mockImplementation(async (_: MigrationConfig) => {
        if (++atlasRunFnCallCount % 2 === 1) {
          return Promise.reject(new MyError(`Atlas error for idx=${atlasRunFnCallCount - 1}`))
        }
        return getAtlasSuccessfulRunResponse()
      })

      const response = await migration.runMigrationFromList(migrationConfigList, dryRun)

      const expectedResponse: MigrationRunListResponse = {
        migrationAvailable: true,
        executionResponseList: [
          AtlasMigrationExecutionResponse.fromError(`Atlas error for idx=0`),
          getAtlasSuccessfulRunResponse()
        ],
        errMsg: 'Atlas error for idx=0'
      }

      expect(response).toEqual(expectedResponse)

      expect(atlasRunFn).toHaveBeenCalledTimes(2)
      expect(atlasRunFn).toHaveBeenNthCalledWith(1, {
        ...expectedMigrationConfigList[0],
        dryRun
      })
      expect(atlasRunFn).toHaveBeenNthCalledWith(2, {
        ...expectedMigrationConfigList[1],
        dryRun
      })
    })
  })
})
