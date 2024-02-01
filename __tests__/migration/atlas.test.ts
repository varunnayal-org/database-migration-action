import path from 'path'

import * as util from '../../src/util'
import * as atlas from '../../src/migration/atlas'
import { MigrationConfig } from '../../src/types'
import { AtlasMigrationExecutionResponse, VersionExecution } from '../../src/migration/atlas-class'
import { TEMP_DIR_FOR_MIGRATION } from '../../src/constants'
import * as c from '../common'

let utilExec: jest.SpyInstance

const getExpectedMigrationConfigList = (dir = '.', dbUrlKey = '', devUrl = ''): MigrationConfig => ({
  dir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
  relativeDir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
  originalDir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
  databaseUrl: dbUrlKey === '' ? 'postgres://root:secret@db.host:5432/appdb?search_path=public' : dbUrlKey,
  baseline: '',
  dryRun: true,
  revisionSchema: 'public',
  devUrl: devUrl === '' ? 'postgres://root:secret@localhost:5432/dev-db?sslmode=disabled&search_path=public' : devUrl
})
function getBaseExecutionList(): VersionExecution[] {
  return [
    {
      Name: '20231129060014_add_user.sql',
      Version: '20231129060014',
      Description: 'add_user',
      Start: '2023-12-11T10:55:19.468908+05:30',
      End: '2023-12-11T10:55:19.470647+05:30',
      Applied: [
        'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
        'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
      ]
    },
    {
      Name: '20231206212844_add_column.sql',
      Version: '20231206212844',
      Description: 'add_column',
      Start: '2023-12-11T10:55:19.470647+05:30',
      End: '2023-12-11T10:55:19.470648+05:30',
      Applied: ['ALTER TABLE "users" ADD COLUMN "email" varchar(255);']
    }
  ]
}

describe('atlas', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    utilExec = jest.spyOn(util, 'exec').mockImplementation()
  })

  describe('run', () => {
    const getExecParams = (mgConfig: MigrationConfig, execArgs: string[], rev = 'public'): string[] => {
      return [
        'migrate',
        'apply',
        '--dir',
        `file://${mgConfig.dir}`,
        '--format',
        '"{{ json .Applied }}"',
        '--exec-order',
        'linear',
        '--tx-mode',
        'file',
        '--lock-timeout',
        '10s',
        '--revisions-schema',
        rev,
        ...execArgs,
        '--url',
        mgConfig.databaseUrl
      ]
    }
    it('should return response', async () => {
      const baseline = '00000000000000_baseline.sql'
      const migrationConfig = getExpectedMigrationConfigList()
      migrationConfig.revisionSchema = 'mySchema'
      migrationConfig.baseline = baseline
      const utilExecFn = utilExec.mockImplementationOnce(() => JSON.stringify(getBaseExecutionList()))

      await atlas.run(migrationConfig)

      expect(utilExecFn).toHaveBeenCalledTimes(2)
      expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
        'migrate',
        'hash',
        '--dir',
        `file://${migrationConfig.dir}`
      ])
      expect(utilExecFn).toHaveBeenNthCalledWith(
        2,
        'atlas',
        getExecParams(migrationConfig, ['--dry-run', '--baseline', baseline], 'mySchema')
      )
    })

    it('should return response for execution dryRun=false', async () => {
      const migrationConfig = getExpectedMigrationConfigList()
      migrationConfig.dryRun = false
      const utilExecFn = utilExec.mockImplementationOnce(() => JSON.stringify(getBaseExecutionList()))

      await atlas.run(migrationConfig)

      expect(utilExecFn).toHaveBeenCalledTimes(2)
      expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
        'migrate',
        'hash',
        '--dir',
        `file://${migrationConfig.dir}`
      ])
      expect(utilExecFn).toHaveBeenNthCalledWith(2, 'atlas', getExecParams(migrationConfig, []))
    })

    it('should return response when errored out with json list', async () => {
      const migrationConfig = getExpectedMigrationConfigList()
      const errMsg = JSON.stringify(getBaseExecutionList())

      let utilExecRunCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const utilExecFn = utilExec.mockImplementation(async (cmd: string, args: string[]) => {
        if (utilExecRunCount++ === 0) {
          return `${cmd} ${args.join(' ')}`
        }
        return Promise.reject(new Error(errMsg))
      })

      const response = await atlas.run(migrationConfig)
      expect(response).toEqual(AtlasMigrationExecutionResponse.build(errMsg))

      expect(utilExecFn).toHaveBeenCalledTimes(2)
      expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
        'migrate',
        'hash',
        '--dir',
        `file://${migrationConfig.dir}`
      ])

      expect(utilExecFn).toHaveBeenNthCalledWith(2, 'atlas', getExecParams(migrationConfig, ['--dry-run']))
    })

    it('should throw on unexpected response', async () => {
      const migrationConfig = getExpectedMigrationConfigList()
      const errMsg = 'Some unwanted error'

      let utilExecRunCount = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const utilExecFn = utilExec.mockImplementation(async (cmd: string, args: string[]) => {
        utilExecRunCount++
        if (utilExecRunCount === 1) {
          return `${cmd} ${args.join(' ')}`
        }
        return Promise.reject(new Error(errMsg))
      })

      const response = await atlas.run(migrationConfig)

      expect(response).toEqual(AtlasMigrationExecutionResponse.fromError(errMsg))
      expect(utilExecFn).toHaveBeenCalledTimes(2)
      expect(utilExecFn).toHaveBeenNthCalledWith(1, 'atlas', [
        'migrate',
        'hash',
        '--dir',
        `file://${migrationConfig.dir}`
      ])
    })
  })

  describe('lint', () => {
    let migrationConfig: MigrationConfig
    beforeEach(() => {
      migrationConfig = getExpectedMigrationConfigList()
      migrationConfig.baseline = '00000000000000_baseline.sql'
    })

    it('should run lint', async () => {
      const utilExecFn = utilExec.mockResolvedValue(c.artifacts.no_lint_error.lintResponseOutput.mg1)
      const response = await atlas.lint(migrationConfig, ['PG101'], ['DS101', 'PG101', 'DS103'])

      expect(response).toEqual({
        fileLintResults: [],
        migrationDir: 'tmp/__migrations__',
        allSkipped: true,
        firstError: undefined
      })
      expect(utilExecFn).toHaveBeenCalledTimes(2)
      expect(utilExecFn).toHaveBeenNthCalledWith(2, 'atlas', [
        'migrate',
        'lint',
        '--dir',
        `file://${migrationConfig.dir}`,
        '--format',
        '"{{ json .Files }}"',
        '--latest',
        `${migrationConfig.lintLatestFiles || 10000}`,
        '--dev-url',
        migrationConfig.devUrl
      ])
    })

    it('should capture lint error', async () => {
      const utilExecFn = utilExec.mockRejectedValue(
        new Error(c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1)
      )

      const response = await atlas.lint(migrationConfig, ['PG101'], ['DS101', 'PG101', 'DS103'])

      expect(response).toEqual({
        fileLintResults: [
          {
            filename: '20231222064941_step3.sql',
            diagnostics: [{ error: 'executing statement: pq: column "email" does not exist' }]
          }
        ],
        migrationDir: 'tmp/__migrations__',
        allSkipped: false,
        firstError: 'executing statement: pq: column "email" does not exist'
      })
      expect(utilExecFn).toHaveBeenCalledTimes(1)
      expect(utilExecFn).toHaveBeenCalledWith('atlas', ['migrate', 'hash', '--dir', `file://${migrationConfig.dir}`])
    })

    it('should capture unwanted error', async () => {
      utilExec.mockRejectedValue(new Error('Unable to connect to database'))

      const response = await atlas.lint(migrationConfig, ['PG101'], ['DS101', 'PG101', 'DS103'])

      expect(response).toEqual({
        fileLintResults: [],
        migrationDir: 'tmp/__migrations__',
        allSkipped: false,
        firstError: 'Unable to connect to database'
      })
    })
  })

  describe('drift', () => {
    let migrationConfig: MigrationConfig
    beforeEach(() => {
      migrationConfig = getExpectedMigrationConfigList()
      migrationConfig.baseline = '00000000000000_baseline.sql'
    })
    const checkAtlasSchemaDrift = (utilExecFn: jest.SpyInstance, mgConfig: MigrationConfig): void => {
      expect(utilExecFn).toHaveBeenCalledTimes(1)
      expect(utilExecFn).toHaveBeenCalledWith('atlas', [
        'schema',
        'diff',
        '--dev-url',
        'postgres://root:secret@localhost:5432/dev-db?sslmode=disabled&search_path=public',
        '--format',
        '"{{ sql . "  " }}"',
        '--exclude',
        'atlas_schema_revisions',
        '--from',
        `file://${mgConfig.dir}`,
        '--to',
        'postgres://root:secret@db.host:5432/appdb?search_path=public'
      ])
    }

    it('should return no drift when no string is returned', async () => {
      const utilExecFn = utilExec.mockImplementationOnce(() => '')

      const drift = await atlas.drift(migrationConfig)

      checkAtlasSchemaDrift(utilExecFn, migrationConfig)
      expect(drift.getStatements().length).toEqual(0)
      expect(drift.getError()).toBeUndefined()
    })

    it('should return no drift when no drift command explicitly mention no drifts', async () => {
      const utilExecFn = utilExec.mockImplementationOnce(() => 'Schemas are synced, no changes to be made.')

      const drift = await atlas.drift(migrationConfig)

      checkAtlasSchemaDrift(utilExecFn, migrationConfig)
      expect(drift.getStatements().length).toEqual(0)
      expect(drift.getError()).toBeUndefined()
    })

    it('should return drifts', async () => {
      const utilExecFn = utilExec.mockImplementationOnce(
        () => `-- Add new schema names "repack"
CREATE SCHEMA "repack";
-- CREATE "new_table" table
CREATE TABLE "public"."new_table" (
  "version" character varying NOT NULL,
  PRIMARY KEY ("version")
);`
      )

      const drift = await atlas.drift(migrationConfig)

      checkAtlasSchemaDrift(utilExecFn, migrationConfig)
      expect(drift.getStatements()).toEqual([
        {
          comment: '-- Add new schema names "repack"',
          command: 'CREATE SCHEMA "repack";\n'
        },
        {
          comment: '-- CREATE "new_table" table',
          command:
            'CREATE TABLE "public"."new_table" (\n' +
            '  "version" character varying NOT NULL,\n' +
            '  PRIMARY KEY ("version")\n' +
            ');\n'
        }
      ])
      expect(drift.getError()).toBeUndefined()
    })

    it('should capture unexpected error from drift', async () => {
      const utilExecFn = utilExec.mockImplementationOnce(
        () => 'Error: cannot diff a schema with a database connection: "public" <> ""'
      )

      const drift = await atlas.drift(migrationConfig)

      checkAtlasSchemaDrift(utilExecFn, migrationConfig)
      expect(drift.getStatements().length).toEqual(0)
      expect(drift.getError()).toEqual('Error: cannot diff a schema with a database connection: "public" <> ""')
    })

    it('should capture error from drift', async () => {
      const driftCmdOutput = `-- Add new schema names "repack"
CREATE SCHEMA "repack";
CREATE TABLE "public"."new_table" (
  "version" character varying NOT NULL,
  PRIMARY KEY ("version")
);`
      const utilExecFn = utilExec.mockImplementationOnce(() => driftCmdOutput)

      const drift = await atlas.drift(migrationConfig)

      checkAtlasSchemaDrift(utilExecFn, migrationConfig)
      expect(drift.getStatements().length).toEqual(0)
      expect(drift.getError()).toEqual(driftCmdOutput)
    })

    it('should capture uncaught exception', async () => {
      const utilExecFn = utilExec.mockRejectedValue(new Error('some error'))

      const drift = await atlas.drift(migrationConfig)

      checkAtlasSchemaDrift(utilExecFn, migrationConfig)
      expect(drift.getStatements().length).toEqual(0)
      expect(drift.getError()).toEqual('some error')
    })
  })
})
