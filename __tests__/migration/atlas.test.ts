import path from 'path'

import * as util from '../../src/util'
import * as atlas from '../../src/migration/atlas'
import { MigrationConfig } from '../../src/types'
import { AtlasMigrationExecutionResponse, VersionExecution } from '../../src/migration/atlas-class'
import { TEMP_DIR_FOR_MIGRATION } from '../../src/constants'

let utilExec: jest.SpyInstance

const getExpectedMigrationConfigList = (dir = '.', dbUrlKey = 'test', devUrl = 'test'): MigrationConfig => ({
  dir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
  relativeDir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
  originalDir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
  databaseUrl: dbUrlKey,
  baseline: '',
  dryRun: true,
  devUrl
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

describe('runUsingAtlas', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    utilExec = jest.spyOn(util, 'exec').mockImplementation()
  })

  it('should return response', async () => {
    const baseline = '00000000000000_baseline.sql'
    const migrationConfig = getExpectedMigrationConfigList()
    migrationConfig.baseline = baseline
    const utilExecFn = utilExec.mockImplementationOnce(() => JSON.stringify(getBaseExecutionList()))

    await atlas.run(migrationConfig)

    expect(utilExecFn).toHaveBeenCalledTimes(2)
    expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
      'migrate',
      'hash',
      '--dir',
      `file://${migrationConfig.dir}`
    ])
    expect(utilExecFn).toHaveBeenNthCalledWith(2, 'atlas', [
      'migrate',
      'apply',
      '--dir',
      `file://${migrationConfig.dir}`,
      '--format',
      '"{{ json .Applied }}"',
      '--dry-run',
      '--baseline',
      baseline,
      '--url',
      `${migrationConfig.databaseUrl}`
    ])
  })

  it('should return response for execution dryRun=false', async () => {
    const migrationConfig = getExpectedMigrationConfigList()
    migrationConfig.dryRun = false
    const utilExecFn = utilExec.mockImplementationOnce(() => JSON.stringify(getBaseExecutionList()))

    await atlas.run(migrationConfig)

    expect(utilExecFn).toHaveBeenCalledTimes(2)
    expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
      'migrate',
      'hash',
      '--dir',
      `file://${migrationConfig.dir}`
    ])
    expect(utilExecFn).toHaveBeenNthCalledWith(2, 'atlas', [
      'migrate',
      'apply',
      '--dir',
      `file://${migrationConfig.dir}`,
      '--format',
      '"{{ json .Applied }}"',
      '--url',
      `${migrationConfig.databaseUrl}`
    ])
  })

  it('should return response when errored out with json list', async () => {
    const migrationConfig = getExpectedMigrationConfigList()
    const errMsg = JSON.stringify(getBaseExecutionList())

    let utilExecRunCount = 0

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const utilExecFn = utilExec.mockImplementation(async (cmd: string, args: string[]) => {
      if (utilExecRunCount++ === 0) {
        return `${cmd} ${args.join(' ')}`
      }
      return Promise.reject(new Error(errMsg))
    })

    const response = await atlas.run(migrationConfig)
    expect(response).toEqual(AtlasMigrationExecutionResponse.build(errMsg))

    expect(utilExecFn).toHaveBeenCalledTimes(2)
    expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
      'migrate',
      'hash',
      '--dir',
      `file://${migrationConfig.dir}`
    ])

    expect(utilExecFn).toHaveBeenNthCalledWith(2, 'atlas', [
      'migrate',
      'apply',
      '--dir',
      `file://${migrationConfig.dir}`,
      '--format',
      '"{{ json .Applied }}"',
      '--dry-run',
      '--url',
      `${migrationConfig.databaseUrl}`
    ])
  })

  it('should throw on unexpected response', async () => {
    const migrationConfig = getExpectedMigrationConfigList()
    const errMsg = 'Some unwanted error'

    let utilExecRunCount = 0

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const utilExecFn = utilExec.mockImplementation(async (cmd: string, args: string[]) => {
      utilExecRunCount++
      if (utilExecRunCount === 1) {
        return `${cmd} ${args.join(' ')}`
      }
      return Promise.reject(new Error(errMsg))
    })

    const response = await atlas.run(migrationConfig)

    expect(response).toEqual(AtlasMigrationExecutionResponse.fromError(errMsg))
    expect(utilExecFn).toHaveBeenCalledTimes(2)
    expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
      'migrate',
      'hash',
      '--dir',
      `file://${migrationConfig.dir}`
    ])
  })
})
