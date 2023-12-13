import * as util from '../util'
import { AtlasMigrationExecutionResponse } from './atlas-class'
import { MigrationConfig, MigrationExecutionResponse } from '../types'

async function run(migrationConfig: MigrationConfig): Promise<MigrationExecutionResponse> {
  const dirInput = `file://${migrationConfig.dir}`

  // Generate hash required step as migrate apply need hash
  await util.exec('atlas', ['migrate', 'hash', '--dir', dirInput])

  const migrateApplyArgs = [
    'migrate',
    'apply',
    '--dir',
    dirInput,
    '--url',
    `${migrationConfig.databaseUrl}`,
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

  try {
    const response = await util.exec('atlas', migrateApplyArgs)
    return AtlasMigrationExecutionResponse.fromResponse(response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: any) {
    if (ex.message.startsWith('[')) {
      return AtlasMigrationExecutionResponse.fromResponse(ex.message)
    }
    throw ex
  }
}

export { run }
