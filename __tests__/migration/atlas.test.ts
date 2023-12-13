import path from 'path'

import * as util from '../../src/util'
import * as migration from '../../src/migration/migration'
import * as atlas from '../../src/migration/atlas'
import { MigrationConfig } from '../../src/types'
import { VersionExecution } from '../../src/migration/atlas-class'

let utilExec: jest.SpyInstance

const getExpectedMigrationConfigList = (dir = '.', dbUrlKey = 'test', schema = 'public'): MigrationConfig => ({
  dir: path.join(migration.TEMP_DIR_FOR_MIGRATION, dir),
  databaseUrl: dbUrlKey,
  schema,
  baseline: '',
  dryRun: true
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
      '--url',
      `${migrationConfig.databaseUrl}`,
      '--format',
      '"{{ json .Applied }}"',
      '--revisions-schema',
      migrationConfig.schema,
      '--dry-run',
      '--baseline',
      baseline
    ])
  })

  it('should return response for execution dryRun=false', async () => {
    const migrationConfig = getExpectedMigrationConfigList()
    migrationConfig.dryRun = false
    const utilExecFn = utilExec.mockImplementationOnce(() => JSON.stringify(getBaseExecutionList()))

    await atlas.run(migrationConfig)

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
      '--url',
      `${migrationConfig.databaseUrl}`,
      '--format',
      '"{{ json .Applied }}"',
      '--revisions-schema',
      migrationConfig.schema
    ])
  })
})
