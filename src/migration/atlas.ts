import * as core from '@actions/core'
import * as util from '../util'
import { AtlasLintResponse, AtlasMigrationExecutionResponse, DriftResponse } from './atlas-class'
import { DriftExecutionResponse, MigrationConfig, MigrationExecutionResponse } from '../types'
import { ATLAS_CONFIG_FILE_NAME, ATLAS_HCL } from '../constants'

process.env.ATLAS_NO_UPDATE_NOTIFIER = '0'

function getDirArg(dirName: string): string {
  return `file://${dirName}`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getAtlasHCLFileArgs(dirName: string): string {
  return `file://${dirName}/${ATLAS_CONFIG_FILE_NAME}`
}

async function hash(dir: string): Promise<void> {
  core.debug('Hashing migrations')
  await util.exec('atlas', ['migrate', 'hash', '--dir', getDirArg(dir)])
}

function getAtlasHCLFile(): [string, string] {
  return [ATLAS_CONFIG_FILE_NAME, ATLAS_HCL]
}

async function lint(
  migrationConfig: MigrationConfig,
  skipErrorCodeList: string[],
  lintCodePrefixes: string[]
): Promise<AtlasLintResponse> {
  try {
    await hash(migrationConfig.dir)
    const lintArgs = [
      'migrate',
      'lint',
      '--dir',
      getDirArg(migrationConfig.dir),
      // '-c',
      // getAtlasHCLFileArgs(migrationConfig.dir),
      '--format',
      '"{{ json .Files }}"',
      '--latest',
      `${migrationConfig.lintLatestFiles || 10000}`,
      '--dev-url',
      migrationConfig.devUrl
    ]
    core.debug(`Linting for directory ${migrationConfig.dir}`)
    const response = await util.exec('atlas', lintArgs)
    return AtlasLintResponse.build(response, migrationConfig.relativeDir, skipErrorCodeList, lintCodePrefixes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: any) {
    // Happens when some migrations were applied, but last one has failed
    if (ex.message.startsWith('[')) {
      return AtlasLintResponse.build(ex.message, migrationConfig.relativeDir, skipErrorCodeList, lintCodePrefixes)
    }
    core.error(`ErrorLint[tmp_dir=${migrationConfig.relativeDir}]: ${ex} ${ex.stack}`)
    return AtlasLintResponse.fromError(ex.message, migrationConfig.relativeDir)
  }
}

async function run(migrationConfig: MigrationConfig): Promise<MigrationExecutionResponse> {
  try {
    // Generate hash required step as migrate apply need hash
    await hash(migrationConfig.dir)

    const migrateApplyArgs = [
      'migrate',
      'apply',
      '--dir',
      getDirArg(migrationConfig.dir),
      '--format',
      '"{{ json .Applied }}"',
      '--exec-order',
      'linear',
      '--tx-mode',
      'file',
      '--lock-timeout',
      '10s'
    ]

    if (migrationConfig.dryRun) {
      migrateApplyArgs.push('--dry-run')
    }
    if (migrationConfig.baseline) {
      migrateApplyArgs.push('--baseline', migrationConfig.baseline.toString())
    }
    // Ensure URL field is at the end so that it doesn't get printed in the logs
    migrateApplyArgs.push('--url', migrationConfig.databaseUrl)

    core.debug(`Migrating for directory ${migrationConfig.dir}`)
    const response = await util.exec('atlas', migrateApplyArgs)
    return AtlasMigrationExecutionResponse.build(response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: any) {
    // Happens when some migrations were applied, but last one has failed
    if (ex.message.startsWith('[')) {
      return AtlasMigrationExecutionResponse.build(ex.message)
    }
    core.error(`ErrorApply[tmp_dir=${migrationConfig.dir}]: ${ex} ${ex.stack}`)
    return AtlasMigrationExecutionResponse.fromError(ex.message)
  }
}

/**
 * Removes the 'search_path' parameter from the database URL.
 * This is typically used to prepare the URL for drift detection, where the search path is not required.
 *
 * @param {string} dbURL - The original database URL.
 * @returns {string} - The modified database URL without the 'search_path' parameter.
 */
function removeSearchPathFromURL(dbURL: string): string {
  const urlObj = new URL(dbURL);
  urlObj.searchParams.delete('search_path')
  return urlObj.href
}

/**
 * Executes the drift detection command using Atlas CLI.
 * Drift detection is the process of identifying differences between the database schema in the
 * migration files and the actual schema in the database.
 * 
 * TODO:
 * - Check if `atlas schema diff` has a command to get diffs in `JSON format`. Till v0.18.0, it does not has any.
 *  - Check [SchemaDiffFuncs](https://github.com/ariga/atlas/blob/master/cmd/atlas/internal/cmdlog/cmdlog.go#L874-L876) variable
 *
 * @param {MigrationConfig} migrationConfig - The configuration for the migration.
 * @returns {Promise<DriftExecutionResponse>} - The response from the drift detection execution
 */
async function drift(migrationConfig: MigrationConfig): Promise<DriftExecutionResponse> {
  try {
    const driftArgs = [
      'schema',
      'diff',
      '--from',
      getDirArg(migrationConfig.dir),
      '--to',
      removeSearchPathFromURL(migrationConfig.databaseUrl),
      '--dev-url',
      removeSearchPathFromURL(migrationConfig.devUrl),
      '--format',
      '"{{ sql . "  " }}"',
    ];

    core.debug(`Drift detection for directory ${migrationConfig.dir}`)
    const response = await util.exec('atlas', driftArgs);
    return DriftResponse.build(response);
  } catch (ex: any) {
    core.error(`ErrorDrift[tmp_dir=${migrationConfig.dir}]: ${ex} ${ex.stack}`);
    return DriftResponse.fromError(ex.message)
  }
}

export { run, lint, drift, getAtlasHCLFile }
