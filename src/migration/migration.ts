import fs from 'fs/promises'
import path from 'path'
import * as core from '@actions/core'

import * as util from '../util'
import {
  DatabaseConfig,
  DriftExecutionResponse,
  DriftRunListResponse,
  LintExecutionResponse,
  MigrationConfig,
  MigrationExecutionResponse,
  MigrationLintResponse,
  MigrationRunListResponse
} from '../types'
import { SecretMap } from '../client/vault/types'
import * as atlas from './atlas'
import { TEMP_DIR_FOR_MIGRATION } from '../constants'

function getDirectoryForDb(baseDirectory: string, dbConfig: DatabaseConfig): string {
  return path.join(process.env.LOCAL_TESTING_REPO_DIR || '', baseDirectory, dbConfig.directory)
}

async function ensureSQLFilesInMigrationDir(sourceDir: string, destinationDir: string): Promise<void> {
  // Read files in source directory
  core.debug(`Reading from: ${sourceDir}`)
  const files = await fs.readdir(sourceDir)

  // Filter only SQL files
  const sqlFiles = files.filter(file => path.extname(file) === '.sql')

  core.info(`SQL Files: \n\t${sqlFiles.join('\n\t')}\n`)
  // Copy files to the destination dir
  for (const file of sqlFiles) {
    const filePath = path.join(sourceDir, file)
    await fs.copyFile(filePath, path.join(destinationDir, file))
  }
}

async function hydrateMigrationConfigWithDBAndDir(
  migrationConfig: MigrationConfig,
  dbConfig: DatabaseConfig,
  secrets: SecretMap
): Promise<MigrationConfig> {
  if (!secrets[dbConfig.envName]) {
    throw new Error(`Secret ${dbConfig.envName} not found`)
  }

  const tempMigrationSQLDir = await util.createTempDir(path.join(TEMP_DIR_FOR_MIGRATION, dbConfig.directory))
  await ensureSQLFilesInMigrationDir(migrationConfig.originalDir, tempMigrationSQLDir)

  migrationConfig.dir = tempMigrationSQLDir
  migrationConfig.databaseUrl = secrets[dbConfig.envName]

  return migrationConfig
}

async function hydrateMigrationConfigList(
  migrationConfigList: MigrationConfig[],
  databases: DatabaseConfig[],
  secrets: SecretMap
): Promise<MigrationConfig[]> {
  return await Promise.all(
    migrationConfigList.map(async (migrationConfig, i) => {
      return hydrateMigrationConfigWithDBAndDir(migrationConfig, databases[i], secrets)
    })
  )
}

async function buildMigrationConfigList(
  baseDirectory: string,
  databases: DatabaseConfig[],
  devUrl: string,
  secrets: SecretMap,
  doHydrate = true
): Promise<MigrationConfig[]> {
  await util.cleanDir(TEMP_DIR_FOR_MIGRATION)

  const migrationList = databases.map(dbConfig => {
    const migrationConfig: MigrationConfig = {
      databaseUrl: '',
      originalDir: getDirectoryForDb(baseDirectory, dbConfig),
      relativeDir: path.join(baseDirectory, dbConfig.directory),
      dir: '', // filled later on when hydrating
      dryRun: true,
      baseline: dbConfig.baseline,
      devUrl,
      revisionSchema: dbConfig.revisionSchema
    }
    return migrationConfig
  })

  if (doHydrate === true) {
    return await hydrateMigrationConfigList(migrationList, databases, secrets || {})
  }
  return migrationList
}

function setDryRun(migrationConfigList: MigrationConfig[], dryRun: boolean): void {
  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
  }
}

/**
 * This function runs linting on a list of migration configurations.
 *
 * @param {MigrationConfig[]} migrationConfigList - An array of migration configurations. Each configuration represents a specific migration.
 * @param {string[]} skipErrorCodeList - An array of error codes to be skipped during the linting process. See https://atlasgo.io/lint/analyzers#checks
 *
 * @returns {Promise<void>} - The function returns a promise that resolves to void. It's an async function, so it can be awaited.
 *
 * @example
 *
 * const migrationConfigs = [{...}, {...}, {...}];
 * const skipCodes = ['E001', 'W002'];
 * await runLintFromList(migrationConfigs, skipCodes);
 */
async function runLintFromList(
  migrationConfigList: MigrationConfig[],
  skipErrorCodeList: string[],
  lintCodePrefixes: string[]
): Promise<MigrationLintResponse> {
  const lintResponseList: LintExecutionResponse[] = []
  let canSkipAllErrors = true

  let errMsg: string | undefined

  for (const migrationConfig of migrationConfigList) {
    const lintResponse = await atlas.lint(migrationConfig, skipErrorCodeList, lintCodePrefixes)
    canSkipAllErrors = canSkipAllErrors && lintResponse.canSkipAllErrors()
    if (!errMsg && lintResponse.getFirstError()) {
      errMsg = lintResponse.getFirstError()
    }
    lintResponseList.push(lintResponse)
  }

  const response: MigrationLintResponse = { lintResponseList, errMsg, canSkipAllErrors }
  core.info(`MigrationLintResponse: ${JSON.stringify(response, null, 2)}`)
  return response
}

async function runMigrationFromList(
  migrationConfigList: MigrationConfig[],
  dryRun: boolean
): Promise<MigrationRunListResponse> {
  let migrationAvailable = false
  let errMsg: string | undefined
  const migrationResponseList: MigrationExecutionResponse[] = []

  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
    const response = await atlas.run(migrationConfig)
    if (response.hasMigrations()) {
      migrationAvailable = true
    }

    if (!errMsg && response.getFirstError()) {
      errMsg = response.getFirstError()
    }
    migrationResponseList.push(response)
  }

  const response: MigrationRunListResponse = {
    migrationAvailable,
    executionResponseList: migrationResponseList,
    errMsg
  }
  core.info(`MigrationRunListResponse: ${JSON.stringify(response, null, 2)}`)
  return response
}

async function runSchemaDriftFromList(migrationConfigList: MigrationConfig[]): Promise<DriftRunListResponse> {
  const drifts: DriftExecutionResponse[] = []
  let errMsg: string | undefined
  let hasSchemaDrifts = false
  for (const migrationConfig of migrationConfigList) {
    const drift = await atlas.drift(migrationConfig)
    if (!errMsg && drift.getError()) {
      errMsg = drift.getError()
    }
    if (drift.getStatements().length > 0) {
      hasSchemaDrifts = true
    }
    drifts.push(drift)
  }
  core.info(`Schema Drift Response: ${JSON.stringify(drifts, null, 2)}`)
  return {
    hasSchemaDrifts,
    drifts,
    errMsg
  }
}

export {
  getDirectoryForDb,
  setDryRun,
  hydrateMigrationConfigList,
  buildMigrationConfigList,
  runMigrationFromList,
  runLintFromList,
  runSchemaDriftFromList
}
