import fs from 'fs'
import migrate from 'node-pg-migrate'
import path from 'path'
import * as core from '@actions/core'

import { createTempDir, cleanDir } from './util'
import { Config } from './config'
import { MigrationConfig, MigrationRunListResponse } from './types'

const TEMP_DIR_FOR_MIGRATION = 'tmp/__migrations__'

async function buildMigrationConfigList(
  config: Config,
  secretValues: Record<string, string>
): Promise<MigrationConfig[]> {
  const migrationConfigList: MigrationConfig[] = []

  cleanDir(TEMP_DIR_FOR_MIGRATION)

  for (const dbConfig of config.databases) {
    const sourceDir = path.join(config.base_directory, dbConfig.directory)
    const tempMigrationSQLDir = await createTempDir(path.join(TEMP_DIR_FOR_MIGRATION, dbConfig.directory))

    await ensureSQLFilesInMigrationDir(sourceDir, tempMigrationSQLDir)

    migrationConfigList.push({
      databaseUrl: secretValues[dbConfig.url_path] || '',
      dir: tempMigrationSQLDir,
      migrationsTable: dbConfig.migration_table,
      direction: 'up',
      checkOrder: true,
      dryRun: true
    })
  }

  return migrationConfigList
}

async function runMigrationFromList(migrationConfigList: MigrationConfig[]): Promise<MigrationRunListResponse> {
  let migrationAvailable = false
  let errMsg: string | null = null
  const migratedFileList: string[][] = []
  for (const migrationConfig of migrationConfigList) {
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
      core.error(ex.message)
      if (errMsg === null) {
        errMsg = `Dir=${migrationConfig.dir} ${ex.message}`
      } else {
        errMsg = `${errMsg}\r\nDir=${migrationConfig.dir} ${ex.message}`
      }
    }
  }
  return {
    migrationAvailable,
    migratedFileList,
    errMsg
  }
}

async function ensureSQLFilesInMigrationDir(sourceDir: string, destinationDir: string): Promise<void> {
  // Read files in source directory
  core.debug(`Reading from: ${sourceDir}`)
  const files = fs.readdirSync(sourceDir)

  // Filter only SQL files
  const sqlFiles = files.filter(file => path.extname(file) === '.sql')

  core.debug(`SQL Files: \n\t${sqlFiles.join('\n\t')}\n`)
  // Copy files to the destination dir
  for (const file of sqlFiles) {
    const filePath = path.join(sourceDir, file)
    fs.copyFileSync(filePath, path.join(destinationDir, file))
  }
}

async function runMigrations(migrationConfig: MigrationConfig): Promise<string[]> {
  try {
    core.debug(`MigrationConfig: ${JSON.stringify(migrationConfig, null, 2)}`)
    // // setup sql -> js for node-pg-migrate
    // const migrationJsDir = await createTempDir('migrations-js');
    // await ensureSQLFilesInMigrationDir(migrationConfig.dir, migrationJsDir);
    // migrationConfig.dir = migrationJsDir;

    // Migrate
    // Output: [{ path: '/path/to/12312.sql', name: '12312', timestamp: 20230921102752 }, ...]
    const response = await migrate(migrationConfig)

    return response.map(file => `${file.name}.sql`)
  } /* catch (error) {
    core.error(`Failed to run migrations: ${error}`);
  } */ finally {
    // await removeDir(migrationJsDir);
  }
}

export { TEMP_DIR_FOR_MIGRATION, buildMigrationConfigList, runMigrationFromList }
