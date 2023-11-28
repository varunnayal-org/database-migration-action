import fs from 'fs/promises'
import path from 'path'
import * as core from '@actions/core'

import { createTempDir, cleanDir, exec } from './util'
import { DatabaseConfig } from './config'
import { MigrationConfig, MigrationResponse, MigrationRunListResponse } from './types'
import { SecretMap } from './client/aws'

const TEMP_DIR_FOR_MIGRATION = 'tmp/__migrations__'

function getDirectoryForDb(baseDirectory: string, dbConfig: DatabaseConfig): string {
  return path.join(baseDirectory, dbConfig.directory)
}

async function buildMigrationConfigList(
  baseDirectory: string,
  databases: DatabaseConfig[],
  secrets: SecretMap
): Promise<MigrationConfig[]> {
  const migrationConfigList: MigrationConfig[] = []

  await cleanDir(TEMP_DIR_FOR_MIGRATION)

  for (const dbConfig of databases) {
    // const sourceDir = path.join(config.baseDirectory, dbConfig.directory)
    const sourceDir = getDirectoryForDb(baseDirectory, dbConfig)

    const tempMigrationSQLDir = await createTempDir(path.join(TEMP_DIR_FOR_MIGRATION, dbConfig.directory))

    await ensureSQLFilesInMigrationDir(sourceDir, tempMigrationSQLDir)

    if (!secrets[dbConfig.envName]) {
      throw new Error(`Secret ${dbConfig.envName} not found`)
    }

    migrationConfigList.push({
      databaseUrl: secrets[dbConfig.envName],
      dir: tempMigrationSQLDir,
      dryRun: true,
      schema: dbConfig.schema,
      baseline: dbConfig.baseline
    })
  }

  return migrationConfigList
}

function setDryRun(migrationConfigList: MigrationConfig[], dryRun: boolean): void {
  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
  }
}

async function runUsingAtlas(migrationConfig: MigrationConfig): Promise<string> {
  const dirInput = `file://${migrationConfig.dir}`

  // Generate hash required step as migrate apply need hash
  await exec('atlas', ['migrate', 'hash', '--dir', dirInput])

  const migrateApplyArgs = [
    'migrate',
    'apply',
    '--dir',
    dirInput,
    '--url',
    `${migrationConfig.databaseUrl}`,
    '--revisions-schema',
    migrationConfig.schema
  ]

  if (migrationConfig.dryRun) {
    migrateApplyArgs.push('--dry-run')
  }
  if (migrationConfig.baseline) {
    migrateApplyArgs.push('--baseline', migrationConfig.baseline.toString())
  }

  const response = await exec('atlas', migrateApplyArgs)
  if (response && response.toLowerCase() === 'no migration files to execute') {
    return ''
  }
  return response
}

async function runMigrationFromList(
  migrationConfigList: MigrationConfig[],
  dryRun: boolean
): Promise<MigrationRunListResponse> {
  let migrationAvailable = false
  let errMsg: string | null = null
  const migrationResponseList: MigrationResponse[] = []
  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
    try {
      const response = await runUsingAtlas(migrationConfig)
      if (response) {
        migrationAvailable = true
        migrationResponseList.push({
          source: 'atlas',
          response
        })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      if (errMsg === null) {
        errMsg = `Dir=${migrationConfig.dir} ${ex.message}`
      } else {
        errMsg = `${errMsg}\r\nDir=${migrationConfig.dir} ${ex.message}`
      }
      console.log(errMsg, ex.stack)
    }
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

export { getDirectoryForDb, setDryRun, buildMigrationConfigList, runMigrationFromList, runUsingAtlas }
