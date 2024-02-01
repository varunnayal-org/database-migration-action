import mock from 'mock-fs'
import fs from 'fs/promises'

import * as atlas from '../../src/migration/atlas'
import * as migration from '../../src/migration/migration'
import { DatabaseConfig, DriftExecutionResponse, MigrationConfig, MigrationRunListResponse } from '../../src/types'
import { SecretMap } from '../../src/client/vault/types'
import { AtlasLintResponse, AtlasMigrationExecutionResponse, AtlasDriftResponse } from '../../src/migration/atlas-class'
import * as c from '../common'
import { LINT_CODE_DEFAULT_PREFIXES, TEMP_DIR_FOR_MIGRATION } from '../../src/constants'

let atlasRun: jest.SpyInstance

const getDB = (directory = '.', envName = 'test'): DatabaseConfig => ({
  directory,
  envName,
  revisionSchema: 'public'
})

const getVaultKeyStore = (...names: string[]): SecretMap =>
  names.length === 0
    ? { test: 'postgres://root:secret@db.host:5432/appdb?search_path=public' }
    : names.reduce((acc, name) => ({ ...acc, [name]: name }), {})

describe('buildMigrationConfigList', () => {
  const devDBUrl = 'postgres://root:secret@localhost:5432/dev-db?sslmode=disabled&search_path=public'
  beforeEach(() => {
    jest.clearAllMocks()
    mock.restore()
    mock(c.getMockDirectories())
  })

  afterEach(() => {
    mock.restore()
  })

  describe('single_database', () => {
    it('should return migration config list', async () => {
      expect(await migration.buildMigrationConfigList('migrations', [getDB()], devDBUrl, getVaultKeyStore())).toEqual(
        c.getMigrationConfigList()
      )
    })

    it('should ignore non sql files', async () => {
      expect(await migration.buildMigrationConfigList('migrations', [getDB()], devDBUrl, getVaultKeyStore())).toEqual(
        c.getMigrationConfigList()
      )

      expect(await fs.readdir(TEMP_DIR_FOR_MIGRATION)).toEqual([
        '00000000000001_create_test_table.sql',
        '00000000000002_create_test2_table.sql'
      ])
    })

    it('should throw error if secret not found', async () => {
      await expect(
        migration.buildMigrationConfigList('migrations', [getDB()], devDBUrl, getVaultKeyStore('test1'))
      ).rejects.toThrow('Secret test not found')
    })

    it('should set dry run to passed value', async () => {
      const migrationConfigList = [...c.getMigrationConfigList(), ...c.getMigrationConfigList('dir2', 'key2')]

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
        ...c.getMigrationConfigList('db1', 'db1_credentials', 'multi_db_dir'),
        ...c.getMigrationConfigList('db2', 'db2_credentials', 'multi_db_dir')
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
      const migrationConfigList = c.getMigrationConfigList()
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
      const migrationConfigList = c.getMigrationConfigList()

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
        ...c.getMigrationConfigList('db1', 'db1_credentials', 'multi_db_dir'),
        ...c.getMigrationConfigList('db2', 'db2_credentials', 'multi_db_dir'),
        ...c.getMigrationConfigList('db3', 'db3_credentials', 'multi_db_dir')
      ]
      migrationConfigList = [
        ...c.getMigrationConfigList('db1', 'db1_credentials', 'multi_db_dir'),
        ...c.getMigrationConfigList('db2', 'db2_credentials', 'multi_db_dir'),
        ...c.getMigrationConfigList('db3', 'db3_credentials', 'multi_db_dir')
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

describe('runLintFromList', () => {
  let atlasLint: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    atlasLint = jest.spyOn(atlas, 'lint').mockImplementation()
  })

  it('should return no error', async () => {
    const migrationConfig = c.getMigrationConfigList()

    const atlasLintFn = atlasLint.mockResolvedValue(
      AtlasLintResponse.build(c.artifacts.no_lint_error.lintResponseOutput.mg1, 'mg1', [], LINT_CODE_DEFAULT_PREFIXES)
    )

    const expectedResponse = {
      lintResponseList: [
        {
          fileLintResults: [],
          migrationDir: 'mg1',
          allSkipped: true,
          firstError: undefined
        }
      ],
      errMsg: undefined,
      canSkipAllErrors: true
    }

    const response = await migration.runLintFromList(migrationConfig, [], LINT_CODE_DEFAULT_PREFIXES)

    expect(response).toEqual(expectedResponse)
    expect(atlasLintFn).toHaveBeenCalledTimes(1)
    expect(atlasLintFn).toHaveBeenCalledWith(migrationConfig[0], [], LINT_CODE_DEFAULT_PREFIXES)
  })

  it('should return error', async () => {
    const migrationConfig = c.getMigrationConfigList()

    const atlasLintFn = atlasLint.mockResolvedValue(
      AtlasLintResponse.build(
        c.artifacts.multiple_linting_errors_in_one_file.lintResponseOutput.mg1,
        'mg1',
        [],
        LINT_CODE_DEFAULT_PREFIXES
      )
    )

    const expectedResponse = {
      lintResponseList: [
        {
          fileLintResults: [
            {
              filename: '20231222064941_step3.sql',
              diagnostics: [
                {
                  message:
                    'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
                  errorCode: 'PG103',
                  errorCodeGroup: 'concurrent index violations detected',
                  pos: 0,
                  canSkip: false
                },
                {
                  message: 'Creating index "idx_users_email" non-concurrently causes write locks on the "users" table',
                  errorCode: 'PG101',
                  errorCodeGroup: 'concurrent index violations detected',
                  pos: 0,
                  canSkip: false
                }
              ]
            }
          ],
          migrationDir: 'mg1',
          allSkipped: false,
          firstError:
            'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction'
        }
      ],
      errMsg:
        'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
      canSkipAllErrors: false
    }

    const response = await migration.runLintFromList(migrationConfig, [], LINT_CODE_DEFAULT_PREFIXES)

    expect(response).toEqual(expectedResponse)
    expect(atlasLintFn).toHaveBeenCalledTimes(1)
    expect(atlasLintFn).toHaveBeenCalledWith(migrationConfig[0], [], LINT_CODE_DEFAULT_PREFIXES)
  })

  it('should skip some errors', async () => {
    const migrationConfig = c.getMigrationConfigList()

    const atlasLintFn = atlasLint.mockResolvedValue(
      AtlasLintResponse.build(
        c.artifacts.multiple_linting_errors_in_one_file.lintResponseOutput.mg1,
        'mg1',
        ['PG103'],
        LINT_CODE_DEFAULT_PREFIXES
      )
    )

    const expectedResponse = {
      lintResponseList: [
        {
          fileLintResults: [
            {
              filename: '20231222064941_step3.sql',
              diagnostics: [
                {
                  message:
                    'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
                  errorCode: 'PG103',
                  errorCodeGroup: 'concurrent index violations detected',
                  pos: 0,
                  canSkip: true
                },
                {
                  message: 'Creating index "idx_users_email" non-concurrently causes write locks on the "users" table',
                  errorCode: 'PG101',
                  errorCodeGroup: 'concurrent index violations detected',
                  pos: 0,
                  canSkip: false
                }
              ]
            }
          ],
          migrationDir: 'mg1',
          allSkipped: false,
          firstError:
            'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction'
        }
      ],
      errMsg:
        'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
      canSkipAllErrors: false
    }

    const response = await migration.runLintFromList(migrationConfig, ['PG103'], LINT_CODE_DEFAULT_PREFIXES)

    expect(response).toEqual(expectedResponse)
    expect(atlasLintFn).toHaveBeenCalledTimes(1)
    expect(atlasLintFn).toHaveBeenCalledWith(migrationConfig[0], ['PG103'], LINT_CODE_DEFAULT_PREFIXES)
  })

  it('should skip all errors', async () => {
    const migrationConfig = c.getMigrationConfigList()

    const atlasLintFn = atlasLint.mockResolvedValue(
      AtlasLintResponse.build(
        c.artifacts.multiple_linting_errors_in_one_file.lintResponseOutput.mg1,
        'mg1',
        ['PG101', 'PG103'],
        LINT_CODE_DEFAULT_PREFIXES
      )
    )

    const expectedResponse = {
      lintResponseList: [
        {
          fileLintResults: [
            {
              filename: '20231222064941_step3.sql',
              diagnostics: [
                {
                  message:
                    'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
                  errorCode: 'PG103',
                  errorCodeGroup: 'concurrent index violations detected',
                  pos: 0,
                  canSkip: true
                },
                {
                  message: 'Creating index "idx_users_email" non-concurrently causes write locks on the "users" table',
                  errorCode: 'PG101',
                  errorCodeGroup: 'concurrent index violations detected',
                  pos: 0,
                  canSkip: true
                }
              ]
            }
          ],
          migrationDir: 'mg1',
          allSkipped: true,
          firstError:
            'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction'
        }
      ],
      errMsg:
        'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
      canSkipAllErrors: true
    }

    const response = await migration.runLintFromList(migrationConfig, ['PG101', 'PG103'], LINT_CODE_DEFAULT_PREFIXES)

    expect(response).toEqual(expectedResponse)
    expect(atlasLintFn).toHaveBeenCalledTimes(1)
    expect(atlasLintFn).toHaveBeenCalledWith(migrationConfig[0], ['PG101', 'PG103'], LINT_CODE_DEFAULT_PREFIXES)
  })
})

describe('runSchemaDriftFromList', () => {
  let atlasDrift: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    atlasDrift = jest.spyOn(atlas, 'drift').mockImplementation()
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atlasDriftMockFn = (driftResponse: DriftExecutionResponse[]): any => {
    let atlasDriftFnCallCount = 0
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return atlasDrift.mockImplementation(async (migrationConfig: MigrationConfig) => {
      ++atlasDriftFnCallCount
      return driftResponse[atlasDriftFnCallCount - 1]
    })
  }

  it('should return no error', async () => {
    const migrationConfig = [
      ...c.getMigrationConfigList('db1', '', 'multi_db_dir'),
      ...c.getMigrationConfigList(
        'db2',
        'postgres://root:secret@db.host:5432/appdb2?search_path=public',
        'multi_db_dir'
      )
    ]

    const atlasDriftFn = atlasDriftMockFn([AtlasDriftResponse.build(''), AtlasDriftResponse.build('')])
    const response = await migration.runSchemaDriftFromList(migrationConfig)

    expect(response).toEqual({
      hasSchemaDrifts: false,
      drifts: [{ statements: [] }, { statements: [] }]
    })
    expect(atlasDriftFn).toHaveBeenCalledTimes(2)
    expect(atlasDriftFn).toHaveBeenNthCalledWith(1, migrationConfig[0])
    expect(atlasDriftFn).toHaveBeenNthCalledWith(2, migrationConfig[1])
  })

  it('should return unexpected error', async () => {
    const migrationConfig = [
      ...c.getMigrationConfigList('db1', '', 'multi_db_dir'),
      ...c.getMigrationConfigList(
        'db2',
        'postgres://root:secret@db.host:5432/appdb2?search_path=public',
        'multi_db_dir'
      ),
      ...c.getMigrationConfigList(
        'db2',
        'postgres://root:secret@db.host:5432/appdb3?search_path=public',
        'multi_db_dir'
      )
    ]

    const atlasDriftFn = atlasDriftMockFn([
      AtlasDriftResponse.build(''),
      AtlasDriftResponse.fromError('some error'),
      AtlasDriftResponse.fromError('some other error')
    ])
    const response = await migration.runSchemaDriftFromList(migrationConfig)

    expect(response).toEqual({
      drifts: [
        { statements: [] },
        { statements: [], error: 'some error' },
        { statements: [], error: 'some other error' }
      ],
      hasSchemaDrifts: false,
      errMsg: 'some error'
    })
    expect(atlasDriftFn).toHaveBeenCalledTimes(3)
    expect(atlasDriftFn).toHaveBeenNthCalledWith(1, migrationConfig[0])
    expect(atlasDriftFn).toHaveBeenNthCalledWith(2, migrationConfig[1])
    expect(atlasDriftFn).toHaveBeenNthCalledWith(3, migrationConfig[2])
  })

  it('should return drift error', async () => {
    const migrationConfig = [
      ...c.getMigrationConfigList('db1', '', 'multi_db_dir'),
      ...c.getMigrationConfigList(
        'db2',
        'postgres://root:secret@db.host:5432/appdb2?search_path=public',
        'multi_db_dir'
      ),
      ...c.getMigrationConfigList(
        'db2',
        'postgres://root:secret@db.host:5432/appdb3?search_path=public',
        'multi_db_dir'
      )
    ]

    const atlasDriftFn = atlasDriftMockFn([
      AtlasDriftResponse.build(''),
      AtlasDriftResponse.build('-- comment\ndrop index a;'),
      AtlasDriftResponse.build('-- comment2\ndrop index b;')
    ])
    const response = await migration.runSchemaDriftFromList(migrationConfig)
    expect(response).toEqual({
      drifts: [
        { statements: [] },
        { statements: [{ command: 'drop index a;\n', comment: '-- comment' }] },
        { statements: [{ command: 'drop index b;\n', comment: '-- comment2' }] }
      ],
      hasSchemaDrifts: true
    })
    expect(atlasDriftFn).toHaveBeenCalledTimes(3)
    expect(atlasDriftFn).toHaveBeenNthCalledWith(1, migrationConfig[0])
    expect(atlasDriftFn).toHaveBeenNthCalledWith(2, migrationConfig[1])
    expect(atlasDriftFn).toHaveBeenNthCalledWith(3, migrationConfig[2])
  })
})
