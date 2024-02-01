import * as core from '@actions/core'
import * as util from '../util'
import { AtlasLintResponse, AtlasMigrationExecutionResponse, AtlasDriftResponse } from './atlas-class'
import { DriftExecutionResponse, MigrationConfig, MigrationExecutionResponse } from '../types'

process.env.ATLAS_NO_UPDATE_NOTIFIER = '0'

const ATLAS_BINARY = 'atlas'
// const ATLAS_BINARY = './database-migration-action/atlas'

function getDirArg(dirName: string): string {
  return `file://${dirName}`
}

async function hash(dir: string): Promise<void> {
  core.debug('Hashing migrations')
  await util.exec(ATLAS_BINARY, ['migrate', 'hash', '--dir', getDirArg(dir)])
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
      '--format',
      '"{{ json .Files }}"',
      '--latest',
      `${migrationConfig.lintLatestFiles || 10000}`,
      '--dev-url',
      migrationConfig.devUrl
    ]
    core.debug(`Linting for directory ${migrationConfig.dir}`)
    const response = await util.exec(ATLAS_BINARY, lintArgs)
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
      '10s',
      '--revisions-schema',
      migrationConfig.revisionSchema
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
    const response = await util.exec(ATLAS_BINARY, migrateApplyArgs)
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
      '--dev-url',
      migrationConfig.devUrl,
      '--format',
      '"{{ sql . "  " }}"',
      '--exclude',
      'atlas_schema_revisions',
      '--from',
      getDirArg(migrationConfig.dir),
      '--to',
      migrationConfig.databaseUrl
    ]

    core.debug(`Drift detection for directory ${migrationConfig.dir}`)
    const response = await util.exec(ATLAS_BINARY, driftArgs)
    return AtlasDriftResponse.build(response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: any) {
    core.error(`ErrorDrift[tmp_dir=${migrationConfig.dir}]: ${ex} ${ex.stack}`)
    return AtlasDriftResponse.fromError(ex.message)
  }
}

export { run, lint, drift }
