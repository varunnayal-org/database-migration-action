import fs from 'fs/promises'
import migrate from 'node-pg-migrate'
import path from 'path'
import * as core from '@actions/core'

import { createTempDir, cleanDir } from './util'
import { DatabaseConfig } from './config'
import { MigrationConfig, MigrationRunListResponse } from './types'
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
      migrationsTable: dbConfig.migration_table,
      direction: 'up',
      checkOrder: true,
      dryRun: true
    })
  }

  return migrationConfigList
}

function setDryRun(migrationConfigList: MigrationConfig[], dryRun: boolean): void {
  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
  }
}

async function runMigrationFromList(
  migrationConfigList: MigrationConfig[],
  dryRun: boolean
): Promise<MigrationRunListResponse> {
  let migrationAvailable = false
  let errMsg: string | null = null
  const migratedFileList: string[][] = []
  for (const migrationConfig of migrationConfigList) {
    migrationConfig.dryRun = dryRun
    try {
      const migratedFiles = await runMigrations(migrationConfig)
      if (migratedFiles.length > 0) {
        migratedFileList.push(migratedFiles)
        migrationAvailable = true
      } else {
        migratedFileList.push([])
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      migratedFileList.push([])
      if (errMsg === null) {
        errMsg = `Dir=${migrationConfig.dir} ${ex.message}`
      } else {
        errMsg = `${errMsg}\r\nDir=${migrationConfig.dir} ${ex.message}`
      }
      console.log(errMsg, ex.stack)
    }
  }

  const response = {
    migrationAvailable,
    migratedFileList,
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

async function runMigrations(migrationConfig: MigrationConfig): Promise<string[]> {
  core.debug(`MigrationConfig: ${JSON.stringify(migrationConfig, null, 2)}`)

  // Migrate
  // Output: [{ path: '/path/to/12312.sql', name: '12312', timestamp: 20230921102752 }, ...]
  const response = await migrate(migrationConfig)

  return response.map(file => `${file.name}.sql`)
}

export { getDirectoryForDb, setDryRun, buildMigrationConfigList, runMigrationFromList }
