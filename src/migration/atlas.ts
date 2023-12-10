import { MigrationConfig } from '../types'
import * as util from '../util'

async function run(migrationConfig: MigrationConfig): Promise<string> {
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
    '--revisions-schema',
    migrationConfig.schema
  ]

  if (migrationConfig.dryRun) {
    migrateApplyArgs.push('--dry-run')
  }
  if (migrationConfig.baseline) {
    migrateApplyArgs.push('--baseline', migrationConfig.baseline.toString())
  }

  const response = await util.exec('atlas', migrateApplyArgs)
  if (response && response.toLowerCase() === 'no migration files to execute') {
    return ''
  }
  return response
}

export { run }
