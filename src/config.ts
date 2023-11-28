import path from 'path'
import { getInput } from './util'

export interface Config {
  /**
   * Directory where migrations are present
   */
  baseDirectory: string

  /**
   * Base branch to which merging should occur
   */
  baseBranch: string
  /**
   * Label to add on PR
   */
  prLabel: string

  /**
   * GitHub teams allowed to approve PR
   */
  approvalTeams: string[]
  ownerTeams: string[]

  /**
   * Combination of approvalTeams and ownerTeams
   */
  allTeams: string[]
  databases: DatabaseConfig[]
  /**
   * List of secrets to fetch from AWS Secrets Manager. Generated from "databases.*.envName"
   */
  dbSecretNameList: string[]
}

export interface DatabaseConfig {
  directory: string
  schema: string
  baseline?: string
  envName: string
}

export default function buildConfig(): Config {
  const configFileName = getInput('migration_config_file', './db.migration.json')
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, import/no-dynamic-require
  const config: Config = require(path.join(process.cwd(), configFileName))

  if (!Array.isArray(config.databases) || config.databases.length === 0) {
    console.log(config)
    throw new Error('No databases configured')
  }

  if (!Array.isArray(config.ownerTeams) || config.ownerTeams.length === 0) {
    console.log(config)
    throw new Error(`No owner team configured. Add ownerTeams in ${configFileName}`)
  }
  config.ownerTeams = [...new Set(config.ownerTeams)]

  // migration.service.ts::#matchTeamWithPRApprovers assumes that this cannot be empty
  if (!Array.isArray(config.approvalTeams) || config.approvalTeams.length === 0) {
    throw new Error(`No approval team configured. Add approvalTeams in ${configFileName}`)
  }
  config.approvalTeams = [...new Set(config.approvalTeams)]

  config.allTeams = [...new Set([...new Set(config.approvalTeams), ...new Set(config.ownerTeams)])]

  if (!config.baseDirectory) {
    config.baseDirectory = './migrations'
  }
  if (!config.baseBranch) {
    config.baseBranch = 'main'
  }
  config.prLabel = 'db-migration'

  config.dbSecretNameList = config.databases.reduce<string[]>((acc, dbConfig, idx) => {
    if (!dbConfig.envName) {
      throw new Error(`Config databases.${idx}.envName is not set`)
    }
    if (acc.includes(dbConfig.envName)) {
      throw new Error(`Config databases.${idx}.envName is duplicate`)
    }
    acc.push(dbConfig.envName)

    if (!dbConfig.directory) {
      dbConfig.directory = '.'
    }
    dbConfig.schema = dbConfig.schema || 'public'
    return acc
  }, [])
  console.log(`Loaded Config from ${configFileName} `, config)

  return config
}
