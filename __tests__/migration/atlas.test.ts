import path from 'path'

import * as util from '../../src/util'
import * as migration from '../../src/migration/migration'
import * as atlas from '../../src/migration/atlas'
import { MigrationConfig } from '../../src/types'

let utilExec: jest.SpyInstance

const getExpectedMigrationConfigList = (dir = '.', dbUrlKey = 'test', schema = 'public'): MigrationConfig => ({
  dir: path.join(migration.TEMP_DIR_FOR_MIGRATION, dir),
  databaseUrl: dbUrlKey,
  schema,
  baseline: '',
  dryRun: true
})

const buildAtlasMockImplementation = (
  fn?: (callNumber: number, command: string, args: string[]) => string
): jest.SpyInstance => {
  const handler = fn || ((callNumber, command, args) => `(call=#${callNumber}) ${command} ${args[0]} ${args[1]}`)
  let callNumber = 0
  return utilExec.mockImplementation(async (command, args) => handler(++callNumber, command, args))
}

describe('runUsingAtlas', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    utilExec = jest.spyOn(util, 'exec').mockImplementation()
  })

  it('should return empty string if no migration files to execute', async () => {
    const migrationConfig = getExpectedMigrationConfigList()
    const utilExecFn = buildAtlasMockImplementation((callNumber, command, args) => {
      if (callNumber % 2 === 1) {
        return `(call=#${callNumber}) ${command} ${args[0]} ${args[1]}`
      }
      return 'No migration FilEs tO execute'
    })

    const response = await atlas.run(migrationConfig)

    // check buildAtlasMockImplementation
    const expectedResponse = ''
    expect(response).toEqual(expectedResponse)

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
      '--revisions-schema',
      migrationConfig.schema,
      '--dry-run'
    ])
  })

  it('should return response', async () => {
    const baseline = '00000000000000_baseline.sql'
    const migrationConfig = getExpectedMigrationConfigList()
    migrationConfig.baseline = baseline
    const utilExecFn = buildAtlasMockImplementation()

    const response = await atlas.run(migrationConfig)

    // check buildAtlasMockImplementation
    const expectedResponse = `(call=#2) atlas migrate apply`
    expect(response).toEqual(expectedResponse)

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
    const utilExecFn = buildAtlasMockImplementation()

    const response = await atlas.run(migrationConfig)

    // check buildAtlasMockImplementation
    const expectedResponse = `(call=#2) atlas migrate apply`
    expect(response).toEqual(expectedResponse)

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
      '--revisions-schema',
      migrationConfig.schema
    ])
  })
})
