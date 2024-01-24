export const CMD_DRY_RUN = 'db migrate dry-run'
export const CMD_DRY_RUN_JIRA = 'db migrate jira'
export const CMD_APPLY = 'db migrate'

export const DEFAULT_BASE_BRANCH = 'main'
export const DEFAULT_MIGRATION_BASE_DIR = './migrations'
export const DEFAULT_MIGRATION_CHILD_DIR = '.'
export const DEFAULT_PR_LABEL = 'db-migration'
export const DEFAULT_PR_JIRA_TICKET_LABEL = 'jira-ticket-created'
export const DEFAULT_JIRA_ISSUE_TYPE = 'Story'
export const DEFAULT_JIRA_COMPLETED_STATUS = 'Done'
export const DEFAULT_JIRA_DRI_APPROVAL_STATUS = 'DONE'

export const NO_MIGRATION_AVAILABLE = 'No migrations available'
export const UNWANTED_FILES_FOUND = 'Unwanted files found'

export const LINT_CODE_DEFAULT_PREFIXES = ['DS', 'BC', 'PG']
export const LINT_SKIP_ERROR_LABEL_PREFIX = 'db-migration:lint:skip:'

export const TEMP_DIR_FOR_MIGRATION = 'tmp/__migrations__'
export const ATLAS_CONFIG_FILE_NAME = 'atlas.hcl'
export const ALLOWED_CHANGED_FILE_EXTENSION = ['.yml', '.yaml', '.sql', '.sum', '.hcl', '.xml', '.json']

// Atlas HCL file for linting (https://atlasgo.io/lint/analyzers)
export const ATLAS_HCL = `lint {
    destructive { // prefix: DS
      error = true
    }
    incompatible { // prefix: BC
      error = true
    }
    concurrent_index { // prefix: PG
      error = true
    }
  }`
