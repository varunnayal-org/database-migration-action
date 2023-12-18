import * as util from '../util'
import { AtlasLintResponse, AtlasMigrationExecutionResponse } from './atlas-class'
import { MigrationConfig, MigrationExecutionResponse } from '../types'

// Atlas HCL file for linting (https://atlasgo.io/lint/analyzers)
// TODO: Use this HCL File
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

async function lint(migrationConfig: MigrationConfig): Promise<AtlasLintResponse> {
  const atlasHCLFile = '' // await util.writeTempFile(atlasHCL)
  const lintArgs = [
    'migrate',
    'lint',
    '--dir',
    `file://${migrationConfig.dir}`,
    '-c',
    `file://${atlasHCLFile}`,
    '--format',
    '--latest',
    '100000', // TODO: Get from PR files
    '"{{ json .Files }}"',
    '--dev-url',
    migrationConfig.devUrl
  ]
  const response = await util.exec('atlas', lintArgs)
  return AtlasLintResponse.build(response)
}

async function run(migrationConfig: MigrationConfig): Promise<MigrationExecutionResponse> {
  const dirInput = `file://${migrationConfig.dir}`

  // Generate hash required step as migrate apply need hash
  await util.exec('atlas', ['migrate', 'hash', '--dir', dirInput])

  const migrateApplyArgs = [
    'migrate',
    'apply',
    '--dir',
    dirInput,
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

export { run, lint }
