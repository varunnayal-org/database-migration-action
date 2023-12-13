import { AtlasMigrationExecutionResponse, VersionExecution } from '../../src/migration/atlas-class'

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

describe('AtlasMigrationExecutionResponse.fromResponse', () => {
  it('should build when migration run successfully', async () => {
    const response = AtlasMigrationExecutionResponse.fromResponse(JSON.stringify(getBaseExecutionList()))

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
    const atlasMigrateApplyJSONResponse = getBaseExecutionList()
    atlasMigrateApplyJSONResponse[1].Applied.push('ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);')

    atlasMigrateApplyJSONResponse[1].Error = {
      Stmt: 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);',
      Text: `pq: table "users.bkp" does not exist`
    }

    const response = AtlasMigrationExecutionResponse.fromResponse(JSON.stringify(atlasMigrateApplyJSONResponse))

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
    const atlasMigrateApplyJSONResponse = getBaseExecutionList()

    atlasMigrateApplyJSONResponse[0].Applied.push('ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);')
    atlasMigrateApplyJSONResponse[0].Error = {
      Stmt: 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);',
      Text: `pq: table "users.bkp" does not exist`
    }

    // atlas returns early error
    atlasMigrateApplyJSONResponse.pop()

    const response = AtlasMigrationExecutionResponse.fromResponse(JSON.stringify(atlasMigrateApplyJSONResponse))

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
        }
      ]
    })
  })

  describe('should build when no migrations are present', () => {
    for (const [value, label] of [
      ['null', 'null'],
      ['', 'empty string']
    ]) {
      it(`when response is ${label}`, async () => {
        const response = AtlasMigrationExecutionResponse.fromResponse(value)
        expect(response).toEqual({
          containsMigrations: false,
          migrations: []
        })
      })
    }
  })

  it('should build when non json string is passed', () => {
    const response = AtlasMigrationExecutionResponse.fromResponse('some atlas error')
    expect(response).toEqual({
      firstError: 'some atlas error',
      containsMigrations: false,
      migrations: []
    })
  })
})
