import { LINT_CODE_DEFAULT_PREFIXES } from '../../src/constants'
import { AtlasLintResponse, AtlasMigrationExecutionResponse } from '../../src/migration/atlas-class'
import * as c from '../common'

describe('AtlasMigrationExecutionResponse', () => {
  describe('build', () => {
    it('should build when migration run successfully', async () => {
      const response = AtlasMigrationExecutionResponse.build(c.executionMap.successful_migration)

      expect(response).toEqual({
        containsMigrations: true,
        migrations: [
          {
            name: '20231129060014_add_user.sql',
            version: '20231129060014',
            description: 'add_user',
            applied: [
              'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
              'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
            ]
          },
          {
            name: '20231206212844_add_column.sql',
            version: '20231206212844',
            description: 'add_column',
            applied: [
              'ALTER TABLE "users" ADD COLUMN "email" varchar(255);'
              // 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);'
            ]
          }
        ]
      })
    })

    it('should build when some migration failed', async () => {
      const response = AtlasMigrationExecutionResponse.build(c.executionMap.some_migration_failed)

      expect(response).toEqual({
        firstError: 'pq: table "users.bkp" does not exist',
        containsMigrations: true,
        migrations: [
          {
            name: '20231129060014_add_user.sql',
            version: '20231129060014',
            description: 'add_user',
            applied: [
              'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
              'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
            ]
          },
          {
            name: '20231206212844_add_column.sql',
            version: '20231206212844',
            description: 'add_column',
            applied: [
              'ALTER TABLE "users" ADD COLUMN "email" varchar(255);',
              'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);'
            ],
            error: {
              statement: 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);',
              error: 'pq: table "users.bkp" does not exist'
            }
          }
        ]
      })
    })

    it('should build when all migration failed', async () => {
      const response = AtlasMigrationExecutionResponse.build(c.executionMap.all_migration_failed)

      expect(response).toEqual({
        firstError: 'pq: table "users.bkp" does not exist',
        containsMigrations: true,
        migrations: [
          {
            name: '20231129060014_add_user.sql',
            version: '20231129060014',
            description: 'add_user',
            applied: [
              'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
              'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);',
              'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);'
            ],
            error: {
              statement: 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);',
              error: 'pq: table "users.bkp" does not exist'
            }
          },
          {
            name: '20231206212844_add_column.sql',
            version: '20231206212844',
            description: 'add_column',
            applied: [
              'ALTER TABLE "users" ADD COLUMN "email" varchar(255);',
              'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
            ],
            error: {
              statement: 'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);',
              error: 'pq: column "phone" of relation "users" already exists'
            }
          }
        ]
      })
    })

    describe('should build when no migrations are present', () => {
      for (const [value, label] of [
        [c.executionMap.no_migration_present, 'null'],
        ['', 'empty string']
      ]) {
        it(`when response is ${label}`, async () => {
          const response = AtlasMigrationExecutionResponse.build(value)
          expect(response).toEqual({
            containsMigrations: false,
            migrations: []
          })
        })
      }
    })

    it('should build when non json string is passed', () => {
      const response = AtlasMigrationExecutionResponse.build('some atlas error')
      expect(response).toEqual({
        firstError: 'some atlas error',
        containsMigrations: false,
        migrations: []
      })
    })
  })

  describe('fromError', () => {
    it('should build', () => {
      const lr = AtlasMigrationExecutionResponse.fromError('some error')
      expect(lr).toEqual({
        containsMigrations: false,
        migrations: [],
        firstError: 'some error'
      })
    })
  })
})

describe('AtlasLintResponse', () => {
  describe('build', () => {
    it('should build when migration run successfully', () => {
      const lr = AtlasLintResponse.build(
        c.artifacts.no_lint_error.lintResponseOutput.mg1,
        'mg1',
        [],
        LINT_CODE_DEFAULT_PREFIXES
      )

      expect(lr).toEqual({ fileLintResults: [], migrationDir: 'mg1', allSkipped: true, firstError: undefined })
    })

    it('should build for file error', () => {
      const lr = AtlasLintResponse.build(
        c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
        'mg1',
        [],
        LINT_CODE_DEFAULT_PREFIXES
      )

      expect(lr).toEqual({
        fileLintResults: [
          {
            filename: '20231222064941_step3.sql',
            diagnostics: [{ error: 'executing statement: pq: column "email" does not exist' }]
          }
        ],
        migrationDir: 'mg1',
        allSkipped: false,
        firstError: 'executing statement: pq: column "email" does not exist'
      })
    })

    it('should build for multiple errors', () => {
      const lr = AtlasLintResponse.build(
        c.artifacts.multiple_linting_errors_in_multiple_files.lintResponseOutput.mg1,
        'mg1',
        [],
        LINT_CODE_DEFAULT_PREFIXES
      )

      expect(lr.canSkipAllErrors()).toEqual(false)
      expect(lr).toEqual({
        fileLintResults: [
          {
            filename: '20231222064929_step2.sql',
            diagnostics: [
              {
                message: 'Dropping non-virtual column "old_email"',
                errorCode: 'DS103',
                errorCodeGroup: 'destructive changes detected',
                pos: 344,
                canSkip: false
              },
              {
                message:
                  'Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty',
                errorCode: 'MF103',
                errorCodeGroup: 'data dependent changes detected',
                pos: 286,
                canSkip: true
              }
            ]
          },
          {
            filename: '20231222064941_step3.sql',
            diagnostics: [
              {
                message:
                  'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
                errorCode: 'PG103',
                errorCodeGroup: 'concurrent index violations detected',
                pos: 0,
                canSkip: false
              },
              {
                message: 'Creating index "idx_users_age" non-concurrently causes write locks on the "users" table',
                errorCode: 'PG101',
                errorCodeGroup: 'concurrent index violations detected',
                pos: 60,
                canSkip: false
              }
            ]
          }
        ],
        migrationDir: 'mg1',
        allSkipped: false,
        firstError: 'Dropping non-virtual column "old_email"'
      })
    })

    it('should build when some errors can be skipped', () => {
      const lr = AtlasLintResponse.build(
        c.artifacts.multiple_linting_errors_in_multiple_files.lintResponseOutput.mg1,
        'mg1',
        ['DS103', 'PG103'],
        LINT_CODE_DEFAULT_PREFIXES
      )

      expect(lr.canSkipAllErrors()).toEqual(false)
      expect(lr).toEqual({
        fileLintResults: [
          {
            filename: '20231222064929_step2.sql',
            diagnostics: [
              {
                message: 'Dropping non-virtual column "old_email"',
                errorCode: 'DS103',
                errorCodeGroup: 'destructive changes detected',
                pos: 344,
                canSkip: true
              },
              {
                message:
                  'Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty',
                errorCode: 'MF103',
                errorCodeGroup: 'data dependent changes detected',
                pos: 286,
                canSkip: true
              }
            ]
          },
          {
            filename: '20231222064941_step3.sql',
            diagnostics: [
              {
                message:
                  'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
                errorCode: 'PG103',
                errorCodeGroup: 'concurrent index violations detected',
                pos: 0,
                canSkip: true
              },
              {
                message: 'Creating index "idx_users_age" non-concurrently causes write locks on the "users" table',
                errorCode: 'PG101',
                errorCodeGroup: 'concurrent index violations detected',
                pos: 60,
                canSkip: false
              }
            ]
          }
        ],
        migrationDir: 'mg1',
        allSkipped: false,
        firstError: 'Dropping non-virtual column "old_email"'
      })
    })

    it('should build when all errors can be skipped', () => {
      const lr = AtlasLintResponse.build(
        c.artifacts.multiple_linting_errors_in_multiple_files.lintResponseOutput.mg1,
        'mg1',
        ['DS103', 'PG103', 'PG101'],
        LINT_CODE_DEFAULT_PREFIXES
      )

      expect(lr.canSkipAllErrors()).toEqual(true)
      expect(lr).toEqual({
        fileLintResults: [
          {
            filename: '20231222064929_step2.sql',
            diagnostics: [
              {
                message: 'Dropping non-virtual column "old_email"',
                errorCode: 'DS103',
                errorCodeGroup: 'destructive changes detected',
                pos: 344,
                canSkip: true
              },
              {
                message:
                  'Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty',
                errorCode: 'MF103',
                errorCodeGroup: 'data dependent changes detected',
                pos: 286,
                canSkip: true
              }
            ]
          },
          {
            filename: '20231222064941_step3.sql',
            diagnostics: [
              {
                message:
                  'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
                errorCode: 'PG103',
                errorCodeGroup: 'concurrent index violations detected',
                pos: 0,
                canSkip: true
              },
              {
                message: 'Creating index "idx_users_age" non-concurrently causes write locks on the "users" table',
                errorCode: 'PG101',
                errorCodeGroup: 'concurrent index violations detected',
                pos: 60,
                canSkip: true
              }
            ]
          }
        ],
        migrationDir: 'mg1',
        allSkipped: true,
        firstError: 'Dropping non-virtual column "old_email"'
      })
    })

    it('should build for null text', () => {
      const lr = AtlasLintResponse.build('null', 'mg1', [], LINT_CODE_DEFAULT_PREFIXES)
      expect(lr).toEqual({
        fileLintResults: [],
        migrationDir: 'mg1',
        allSkipped: false,
        firstError: undefined
      })
    })

    it('should build for unwanted error', () => {
      const lr = AtlasLintResponse.build('cannot execute atlas hash', 'mg1', [], LINT_CODE_DEFAULT_PREFIXES)
      expect(lr).toEqual({
        fileLintResults: [],
        migrationDir: 'mg1',
        allSkipped: false,
        firstError: 'cannot execute atlas hash'
      })
    })
  })

  describe('fromError', () => {
    it('should build', () => {
      const lr = AtlasLintResponse.fromError('some error', 'mg1')
      expect(lr.canSkipAllErrors()).toEqual(false)
      expect(lr).toEqual({ fileLintResults: [], migrationDir: 'mg1', allSkipped: false, firstError: 'some error' })
    })
  })
})
