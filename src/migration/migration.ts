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
const hasExtension = (file: string, ext: string): boolean => path.extname(file) === ext
const hasExtensions = (file: string, exts: string[]): boolean => exts.includes(path.extname(file))

function getRelativePathForDbDirectory(directory: string): string {
  if (process.env.LOCAL_TESTING_REPO_DIR) {
    return path.relative(process.env.LOCAL_TESTING_REPO_DIR, directory)
  }
  return directory
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

async function ensureAtlasConfigFile(sourceDir: string): Promise<void> {
  const [atlasConfigFileName, atlasConfigFileContent] = atlas.getAtlasHCLFile()
  await fs.writeFile(path.join(sourceDir, atlasConfigFileName), atlasConfigFileContent)
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
  await ensureSQLFilesInMigrationDir(migrationConfig.dir, tempMigrationSQLDir)
  await ensureAtlasConfigFile(tempMigrationSQLDir)

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
      dir: getDirectoryForDb(baseDirectory, dbConfig), // source directory
      dryRun: true,
      schema: dbConfig.schema,
      baseline: dbConfig.baseline,
      devUrl
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
      errMsg = (ex.message || `${ex}`) as string
      lintResponseList.push(AtlasLintResponse.fromError(errMsg, migrationConfig.dir))
      core.info(`ErrorLint[tmp_dir=${migrationConfig.dir}]: ${ex} ${ex.stack}`)
    }
  }

  return { lintResponseList, errMsg }
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
      errMsg = (ex.message || `${ex}`) as string
      response = AtlasMigrationExecutionResponse.fromError(errMsg)
      core.info(`ErrorApply[tmp_dir=${migrationConfig.dir}]: ${ex} ${ex.stack}`)
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

export {
  getDirectoryForDb,
  getRelativePathForDbDirectory,
  setDryRun,
  hasExtension,
  hasExtensions,
  hydrateMigrationConfigList,
  buildMigrationConfigList,
  runMigrationFromList,
  runLintFromList
}
