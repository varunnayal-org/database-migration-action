// Used from .vscode/launch.json
import { run } from './main'

process.env.INPUT_REPO_TOKEN = process.env.DB_MIGRATION_GITHUB_TOKEN
process.env.INPUT_AWS_SECRET_STORE = process.env.DB_MIGRATION_SECRET_STORE
process.env.INPUT_DEV_DB_URL = process.env.DB_MIGRATION_DEV_DB_URL

process.env.INPUT_JIRA_CONFIG = process.env.DB_MIGRATION_JIRA_CONFIG || ''
process.env.INPUT_JIRA_USERNAME = process.env.DB_MIGRATION_JIRA_USERNAME || ''
process.env.INPUT_JIRA_PASSWORD = process.env.DB_MIGRATION_JIRA_PASSWORD || ''

process.env.GITHUB_RUN_ID = process.env.GITHUB_RUN_ID || ''
process.env.GITHUB_RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT || '1'
process.env.GITHUB_STEP_SUMMARY = '/tmp/step_summary.txt'

process.env.AWS_ACCESS_KEY_ID = process.env.DB_MIGRATION_AWS_ACCESS_KEY_ID || 'dummy'
process.env.AWS_SECRET_ACCESS_KEY = process.env.DB_MIGRATION_AWS_ACCESS_KEY_SECRET || 'dummy'
process.env.AWS_ENDPOINT_URL = process.env.DB_MIGRATION_AWS_ENDPOINT_URL
process.env.INPUT_DB_MIGRATION_ECHO_URL = process.env.DB_MIGRATION_ECHO_URL

process.env.INPUT_DEBUG = process.env.INPUT_DEBUG || process.env.DEBUG

// LOCAL_TESTING_REPO_DIR: Path to the local repository to test against. It contains
// - db.migration.json (if other file, then provide INPUT_MIGRATION_CONFIG_FILE variable
// - migrations directory as per config file
const envMissing = ['GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME', 'LOCAL_TESTING_REPO_DIR'].filter(key => !process.env[key])
if (envMissing.length > 0) {
  throw new Error(`Missing environment variables: ${envMissing.join(', ')}`)
}

try {
  run()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} catch (ex: any) {
  console.error('[RUN ERROR]: ', ex)
}
