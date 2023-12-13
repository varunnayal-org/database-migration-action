import { MigrationExecutionResponse, MigrationVersionExecutionResponse, VersionExecutionError } from '../types'

export interface VersionExecution {
  Name: string
  Version: string
  Description: string
  Start: string
  End: string
  Error?: {
    Stmt: string
    Text: string
  }
  Applied: string[]
}

class AtlasVersionExecutionError implements VersionExecutionError {
  constructor(
    private statement: string,
    private error: string
  ) {}

  getStatement(): string {
    return this.statement
  }
  getError(): string {
    return this.error
  }
}

class AtlasVersionExecution implements MigrationVersionExecutionResponse {
  constructor(
    private name: string,
    private version: string,
    private description: string,
    private applied: string[] = [],
    private error?: AtlasVersionExecutionError
  ) {}

  static fromVersionExecution(versionExecution: VersionExecution): AtlasVersionExecution {
    if (!versionExecution.Applied) {
      versionExecution.Applied = []
    }

    return new AtlasVersionExecution(
      versionExecution.Name,
      versionExecution.Version,
      versionExecution.Description,
      versionExecution.Applied,
      versionExecution.Error
        ? new AtlasVersionExecutionError(versionExecution.Error.Stmt, versionExecution.Error.Text)
        : undefined
    )
    // return versionExecution
  }

  getName(): string {
    return this.name
  }
  getVersion(): string {
    return this.version
  }
  getDescription(): string {
    return this.description
  }
  getAppliedStatements(): string[] {
    return this.applied
  }
  hasAppliedStatements(): boolean {
    return this.getAppliedStatements().length > 0
  }
  getVersionError(): VersionExecutionError | undefined {
    return this.error
  }
}

/**
 * Represents the response of a migration execution.
 */
export class AtlasMigrationExecutionResponse implements MigrationExecutionResponse {
  private constructor(
    private containsMigrations: boolean,
    private migrations: AtlasVersionExecution[],
    private firstError?: string
  ) {}

  getSource(): string {
    return 'atlas'
  }

  static fromError(error: string): AtlasMigrationExecutionResponse {
    return new AtlasMigrationExecutionResponse(false, [], error)
  }

  static fromResponse(atlasResponse: string): AtlasMigrationExecutionResponse {
    let migrations: AtlasVersionExecution[] = []
    let hasMigrations = false
    let firstError: string | undefined
    try {
      const parsedAtlasResponse = JSON.parse(atlasResponse)
      if (parsedAtlasResponse === null) {
        throw new Error('null response')
      }
      migrations = parsedAtlasResponse.map((versionExecutionJson: VersionExecution) => {
        const versionExecution = AtlasVersionExecution.fromVersionExecution(versionExecutionJson)
        const statementErr = versionExecution.getVersionError()
        if (statementErr && !firstError) {
          firstError = statementErr.getError()
        }
        if (versionExecution.hasAppliedStatements()) {
          hasMigrations = true
        }
        return versionExecution
      })
    } catch (ex) {
      if (atlasResponse && atlasResponse !== 'null') {
        firstError = atlasResponse
      }
    }

    return new AtlasMigrationExecutionResponse(hasMigrations, migrations, firstError)
  }

  hasMigrations(): boolean {
    return this.containsMigrations
  }

  getFirstError(): string | undefined {
    return this.firstError
  }

  getExecutedMigrations(): MigrationVersionExecutionResponse[] {
    return this.migrations
  }
}
