import {
  LintFileResult,
  LintDiagnosticError,
  LintExecutionResponse,
  MigrationExecutionResponse,
  MigrationVersionExecutionResponse,
  VersionExecutionError
} from '../types'

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
  getMessage(): string {
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

  static build(atlasResponse: string): AtlasMigrationExecutionResponse {
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
          firstError = statementErr.getMessage()
        }
        if (versionExecution.hasAppliedStatements()) {
          hasMigrations = true
        }
        return versionExecution
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
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

class AtlasFileDiagnostic implements LintDiagnosticError {
  constructor(
    private message: string, // Files[*].Reports[*].Diagnostics[*].Text
    private errorCode: string, // Files[*].Reports[*].Diagnostics[*].Code
    private errorCodeGroup: string, // Files[*].Reports[*].Text
    private pos: number, // Files[*].Reports[*].Diagnostics[*].Pos
    private canSkip = false
  ) {}

  getMessage(): string {
    return this.message
  }
  getErrorCode(): string {
    return this.errorCode
  }
  getErrorCodeDescription(): string {
    return this.errorCodeGroup
  }
  getPosition(): number {
    return this.pos
  }
  getHelpUrl(): string {
    return `https://atlasgo.io/lint/analyzers#${this.errorCode}`
  }
  isSkipped(): boolean {
    return this.canSkip
  }
}

export class AtlasLintFileErrorDiagnostic implements LintDiagnosticError {
  constructor(private error: string) {}
  getMessage(): string {
    return this.error
  }
  getErrorCode(): string {
    return ''
  }
  getPosition(): number {
    return -1
  }
  getHelpUrl(): string {
    return ''
  }
  isSkipped(): boolean {
    return false
  }
}

export class FileLintResponse implements LintFileResult {
  constructor(
    private filename: string,
    private diagnostics: LintDiagnosticError[]
  ) {}

  getName(): string {
    return this.filename
  }
  getDiagnostics(): LintDiagnosticError[] {
    return this.diagnostics
  }
}

export class AtlasLintResponse implements LintExecutionResponse {
  /**
   * ```json
   * {
   *  "File1.sql": {
   *   "error_code_A": [
   *      { message: "", errorCode: "", errorCodeGroup: "" },
   *      { message: "", errorCode: "", errorCodeGroup: "" },
   *   ],
   *   "error_code_B": [
   *      { message: "", errorCode: "", errorCodeGroup: "" },
   *   ],
   *   ...
   *  }
   * }
   * ```
   * @param byFilename
   */
  constructor(
    private fileLintResults: LintFileResult[],
    private migrationDir: string,
    private allSkipped = false,
    private firstError?: string
  ) {}

  getFileLintResults(): LintFileResult[] {
    return this.fileLintResults
  }

  getFirstError(): string | undefined {
    return this.firstError
  }

  getMigrationDirectory(): string {
    return this.migrationDir
  }

  canSkipAllErrors(): boolean {
    return this.allSkipped
  }

  static fromError(error: string, migrationDir: string): AtlasLintResponse {
    return new AtlasLintResponse([], migrationDir, false, error)
  }

  static build(
    atlasResponse: string,
    migrationDir: string,
    skipErrorCodeList: string[],
    lintCodePrefixes: string[] = []
  ): AtlasLintResponse {
    let firstError: string | undefined
    let allSkipped = true
    let fileLintResults: LintFileResult[] = []
    try {
      const parsedAtlasResponse = JSON.parse(atlasResponse)
      if (parsedAtlasResponse === null) {
        allSkipped = false
        throw new Error('null response')
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fileLintResults = parsedAtlasResponse.map((reportContext: any) => {
        const diagnostics: LintDiagnosticError[] = []
        const reports = reportContext.Reports || []

        if (reportContext.Error && reports.length === 0) {
          allSkipped = false
          if (!firstError) {
            firstError = reportContext.Error
          }
          diagnostics.push(new AtlasLintFileErrorDiagnostic(reportContext.Error))
        }

        for (const reportJson of reports) {
          for (const diagnosticJson of reportJson.Diagnostics || []) {
            // if the error code is not allowed, then continue
            if (!lintCodePrefixes.some(prefix => diagnosticJson.Code.startsWith(prefix))) {
              continue
            }
            if (!firstError) {
              firstError = diagnosticJson.Text
            }
            const canSkipError = skipErrorCodeList.includes(diagnosticJson.Code)
            allSkipped = allSkipped && canSkipError
            diagnostics.push(
              new AtlasFileDiagnostic(
                diagnosticJson.Text,
                diagnosticJson.Code,
                reportJson.Text,
                diagnosticJson.Pos,
                canSkipError
              )
            )
          }
        }

        if (diagnostics.length > 0) {
          return new FileLintResponse(reportContext.Name, diagnostics)
        }
        return null
      })

      fileLintResults = fileLintResults.filter(lintResult => lintResult !== null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      if (atlasResponse && atlasResponse !== 'null') {
        allSkipped = false
        firstError = atlasResponse
      }
    }

    return new AtlasLintResponse(fileLintResults, migrationDir, allSkipped, firstError)
  }
}