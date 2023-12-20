import * as core from '@actions/core'
import * as util from '../util'
import { AtlasLintResponse, AtlasMigrationExecutionResponse } from './atlas-class'
import { MigrationConfig, MigrationExecutionResponse } from '../types'

const ATLAS_CONFIG_FILE_NAME = 'atlas.hcl'
// Atlas HCL file for linting (https://atlasgo.io/lint/analyzers)
const atlasHCL = `lint {
  destructive {
    error = true
  }
  incompatible {
    error = true
  }
  concurrent_index {
    error = true
  }
}`

function getDirArg(dirName: string): string {
  return `file://${dirName}`
}
function getAtlasHCLFileArgs(dirName: string): string {
  return `file://${dirName}/${ATLAS_CONFIG_FILE_NAME}`
}

async function hash(dir: string): Promise<void> {
  core.debug('Hashing migrations')
  await util.exec('atlas', ['migrate', 'hash', '--dir', getDirArg(dir)])
}

function getAtlasHCLFile(): [string, string] {
  return [ATLAS_CONFIG_FILE_NAME, atlasHCL]
}

async function lint(migrationConfig: MigrationConfig): Promise<AtlasLintResponse> {
  await hash(migrationConfig.dir)
  const lintArgs = [
    'migrate',
    'lint',
    '--dir',
    getDirArg(migrationConfig.dir),
    '-c',
    getAtlasHCLFileArgs(migrationConfig.dir),
    '--format',
    '"{{ json .Files }}"',
    '--latest',
    `${migrationConfig.lintLatestFiles || 10000}`,
    '--dev-url',
    migrationConfig.devUrl
  ]
  try {
    core.debug(`Linting for directory ${migrationConfig.dir}`)
    const response = await util.exec('atlas', lintArgs)
    return AtlasLintResponse.build(response, migrationConfig.dir)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: any) {
    // Happens when some migrations were applied, but last one has failed
    if (ex.message.startsWith('[')) {
      return AtlasLintResponse.build(ex.message, migrationConfig.dir)
    }
    throw ex
  }
}

async function run(migrationConfig: MigrationConfig): Promise<MigrationExecutionResponse> {
  // Generate hash required step as migrate apply need hash
  await hash(migrationConfig.dir)

  const migrateApplyArgs = [
    'migrate',
    'apply',
    '--dir',
    getDirArg(migrationConfig.dir),
    '--format',
    '"{{ json .Applied }}"',
    '--revisions-schema',
    migrationConfig.schema
  ]

  if (migrationConfig.dryRun) {
    migrateApplyArgs.push('--dry-run')
  }
  if (migrationConfig.baseline) {
    migrateApplyArgs.push('--baseline', migrationConfig.baseline.toString())
  }

  // Ensure URL field is at the end so that it doesn't get printed in the logs
  migrateApplyArgs.push('--url', migrationConfig.databaseUrl)

  try {
    core.debug(`Migrating for directory ${migrationConfig.dir}`)
    const response = await util.exec('atlas', migrateApplyArgs)
    return AtlasMigrationExecutionResponse.build(response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: any) {
    // Happens when some migrations were applied, but last one has failed
    if (ex.message.startsWith('[')) {
      return AtlasMigrationExecutionResponse.build(ex.message)
    }
    throw ex
  }
}

export { run, lint, getAtlasHCLFile }
