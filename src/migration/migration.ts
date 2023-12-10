import fs from 'fs/promises'
import path from 'path'
import * as core from '@actions/core'

import * as util from '../util'
import { DatabaseConfig } from '../config'
import { MigrationConfig, MigrationResponse, MigrationRunListResponse } from '../types'
import { SecretMap } from '../client/vault/types'
import * as atlas from './atlas'

export const TEMP_DIR_FOR_MIGRATION = 'tmp/__migrations__'

function getDirectoryForDb(baseDirectory: string, dbConfig: DatabaseConfig): string {
  return path.join(baseDirectory, dbConfig.directory)
}

async function buildMigrationConfigList(
  baseDirectory: string,
  databases: DatabaseConfig[],
  secrets: SecretMap
): Promise<MigrationConfig[]> {
  const migrationConfigList: MigrationConfig[] = []

  await util.cleanDir(TEMP_DIR_FOR_MIGRATION)

  for (const dbConfig of databases) {
    // const sourceDir = path.join(config.baseDirectory, dbConfig.directory)
    const sourceDir = getDirectoryForDb(baseDirectory, dbConfig)

    const tempMigrationSQLDir = await util.createTempDir(path.join(TEMP_DIR_FOR_MIGRATION, dbConfig.directory))

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
      const response = await atlas.run(migrationConfig)
      if (response) {
        migrationAvailable = true
      }
      migrationResponseList.push({
        source: 'atlas',
        response
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      const msg = `Dir=${migrationConfig.dir} ${ex.message}`
      if (errMsg === null) {
        errMsg = msg
      } else {
        errMsg = `${errMsg}\r\n${msg}`
      }
      migrationResponseList.push({
        source: 'atlas',
        response: '',
        error: ex.message
      })
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

export { getDirectoryForDb, setDryRun, buildMigrationConfigList, runMigrationFromList }
