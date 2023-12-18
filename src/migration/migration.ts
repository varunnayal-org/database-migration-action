import fs from 'fs/promises'
import path from 'path'
import * as core from '@actions/core'

import * as util from '../util'
import { DatabaseConfig } from '../config'
import {
  LintExecutionResponse,
  MigrationConfig,
  MigrationExecutionResponse,
  MigrationLintResponse,
  MigrationRunListResponse
} from '../types'
import { SecretMap } from '../client/vault/types'
import * as atlas from './atlas'
import { AtlasLintResponse, AtlasMigrationExecutionResponse } from './atlas-class'

export const TEMP_DIR_FOR_MIGRATION = 'tmp/__migrations__'

function getDirectoryForDb(baseDirectory: string, dbConfig: DatabaseConfig): string {
  return path.join(process.env.LOCAL_TESTING_REPO_DIR || '', baseDirectory, dbConfig.directory)
}

async function buildMigrationConfigList(
  baseDirectory: string,
  databases: DatabaseConfig[],
  secrets: SecretMap,
  devUrl: string
): Promise<MigrationConfig[]> {
  const migrationConfigList: MigrationConfig[] = []

  await util.cleanDir(TEMP_DIR_FOR_MIGRATION)

  for (const dbConfig of databases) {
    if (!secrets[dbConfig.envName]) {
      throw new Error(`Secret ${dbConfig.envName} not found`)
    }

    // const sourceDir = path.join(config.baseDirectory, dbConfig.directory)
    const sourceDir = getDirectoryForDb(baseDirectory, dbConfig)

    const tempMigrationSQLDir = await util.createTempDir(path.join(TEMP_DIR_FOR_MIGRATION, dbConfig.directory))

    await ensureSQLFilesInMigrationDir(sourceDir, tempMigrationSQLDir)

    migrationConfigList.push({
      databaseUrl: secrets[dbConfig.envName],
      dir: tempMigrationSQLDir,
      dryRun: true,
      schema: dbConfig.schema,
      baseline: dbConfig.baseline,
      devUrl
    })
  }

  return migrationConfigList
}

function setDryRun(migrationConfigList: MigrationConfig[], dryRun: boolean): void {
  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
  }
}

async function runLintFromList(migrationConfigList: MigrationConfig[]): Promise<MigrationLintResponse> {
  const lintResponseList: LintExecutionResponse[] = []

  let errMsg: string | undefined

  for (const migrationConfig of migrationConfigList) {
    try {
      const lintResponse = await atlas.lint(migrationConfig)
      if (!errMsg && lintResponse.getFirstError()) {
        errMsg = lintResponse.getFirstError()
      }
      lintResponseList.push(lintResponse)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      errMsg = ex.message || `${ex}`
      const exceptionMessage = ex.message || `${ex}`
      lintResponseList.push(AtlasLintResponse.fromError(exceptionMessage))
      core.info(`Exception[tmp_dir=${migrationConfig.dir}]: ${ex}`)
    }
  }
  return {
    lintResponseList: lintResponseList,
    errMsg
  }
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
    let response: MigrationExecutionResponse
    try {
      response = await atlas.run(migrationConfig)
      if (response.hasMigrations()) {
        migrationAvailable = true
      }

      if (!errMsg && response.getFirstError()) {
        errMsg = response.getFirstError()
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      const exceptionMessage = ex.message || `${ex}`
      errMsg = ex.message || `${ex}`
      response = AtlasMigrationExecutionResponse.fromError(exceptionMessage)
      core.info(`Exception[tmp_dir=${migrationConfig.dir}]: ${ex} ${ex.stack}`)
    }
    migrationResponseList.push(response)
  }

  const response: MigrationRunListResponse = {
    migrationAvailable,
    executionResponseList: migrationResponseList,
    errMsg
  }
  core.debug(`MigrationRunListResponse: ${JSON.stringify(response, null, 2)}`)
  return response
}

async function ensureSQLFilesInMigrationDir(sourceDir: string, destinationDir: string): Promise<void> {
  // Read files in source directory
  core.debug(`Reading from: ${sourceDir}`)
  const files = await fs.readdir(sourceDir)

  // Filter only SQL files
  const sqlFiles = files.filter(file => path.extname(file) === '.sql')

  core.debug(`SQL Files: \n\t${sqlFiles.join('\n\t')}\n`)
  // Copy files to the destination dir
  for (const file of sqlFiles) {
    const filePath = path.join(sourceDir, file)
    await fs.copyFile(filePath, path.join(destinationDir, file))
  }
}

export { getDirectoryForDb, setDryRun, buildMigrationConfigList, runMigrationFromList, runLintFromList }
