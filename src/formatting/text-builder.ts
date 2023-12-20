import { Formatter, LintExecutionResponse, MigrationRunListResponse } from '../types'
import { readableDate } from '../util'
import { Platform, formatterMap } from './formatters'

export class TextBuilder {
  constructor(
    private dryRun: boolean,
    private prLink: string,
    private repoLink: string,
    private dbDirList: string[]
  ) {}

  #buildTableAndSQLStatement(fmt: Formatter, response: MigrationRunListResponse): [string, string] {
    let sqlStatementString = ''

    const tableStr = response.executionResponseList.reduce<string>((acc, executionResponseList, idx) => {
      sqlStatementString += `-- DIRECTORY: ${this.dbDirList[idx]}`
      const migrationDirMsg = `*Directory*: **${this.dbDirList[idx]}**`
      if (executionResponseList.hasMigrations() === false) {
        sqlStatementString += '\n    -- No migration available\n\n'
        return `${migrationDirMsg}: No migration available\n\n`
      }

      const table = executionResponseList.getExecutedMigrations().reduce<string>(
        (tableRows, version) => {
          const versionErr = version.getVersionError()
          const successfullyExecutedStatementList = version.getAppliedStatements()
          if (versionErr) {
            successfullyExecutedStatementList.pop()
          }
          const rowString = [
            // emoji
            fmt[versionErr ? 'failure' : 'success'],
            // filename
            `${version.getName()}`,
            // statements executed
            // if a statement has errored out, that will be captured in applied statement. Hence remove it
            successfullyExecutedStatementList.length,
            // error
            fmt.cEsc(versionErr?.getMessage() ? `${versionErr.getMessage()}` : '-'),
            // error statement
            fmt.cEsc(versionErr?.getStatement() ? `${versionErr.getStatement()}` : '-')
          ].join(fmt.rSep)

          sqlStatementString += `\n-- File: ${version.getName()}\n${successfullyExecutedStatementList.join('\n')}\n`
          return `${tableRows}\n${fmt.rSep}${rowString}${fmt.rSep}`
        },
        fmt.headerBuilder([
          'Status',
          'File',
          `${this.dryRun ? 'Total' : 'Executed'} Statements`,
          'Error',
          'Error Statement'
        ])
      )

      sqlStatementString += '\n\n'
      acc += `${migrationDirMsg}\n${table}\n\n`
      return acc
    }, '')

    return [tableStr, sqlStatementString.trim()]
  }

  /**
   * Builds a comment message and context string based on the provided parameters.
   * If a commentId is present in the migrationMeta, the comment body is used as the context string.
   * Otherwise, the context string is constructed using the triggeredBy login, eventName, and actionName from the migrationMeta.
   * The comment message includes information about the migration status, error message (if any), and a link to the GitHub Actions run.
   * If a table is available, it is also included in the comment message.
   * @param response - The MigrationRunListResponse object.
   * @param formatter - The Formatter object used for formatting.
   * @returns An array containing the comment message and context string.
   */
  #build(response: MigrationRunListResponse, formatter: Formatter): string {
    const printMsgPrefix = this.dryRun ? '[DryRun]Migrations' : 'Migrations'
    let printStatus = 'successful'
    let printEmoji = formatter.success

    let printErrMsg = response.errMsg
    if (!printErrMsg && response.migrationAvailable === false) {
      printErrMsg = 'No migrations available'
    }

    if (printErrMsg) {
      printStatus = 'failed'
      printEmoji = formatter.failure
    }

    const ghActionUrl = `${this.repoLink}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${
      process.env.GITHUB_RUN_ATTEMPT || '1'
    }`

    const lines = [
      `${printEmoji} **${printMsgPrefix} ${printStatus}** ${readableDate()} ${formatter.linkBuilder(
        'View',
        ghActionUrl
      )}`
    ]

    if (printErrMsg) {
      lines.push(`${formatter.quoteBuilder(printErrMsg)}`)
    }

    if (response.executionResponseList.length > 0) {
      const [table, sqlStatements] = this.#buildTableAndSQLStatement(formatter, response)
      lines.push(table)
      lines.push(formatter.sqlStatementBuilder(sqlStatements))
    }

    return lines.join('\n')
  }

  jira(response: MigrationRunListResponse): string {
    return this.#build(response, formatterMap.jira)
  }

  github(response: MigrationRunListResponse): string {
    return this.#build(response, formatterMap.github)
  }

  #buildLintMessage(lintResults: LintExecutionResponse[], fmt: Formatter): string {
    const nonTableErrors: string[] = []
    const tableRowsStr = lintResults.reduce<string>((tableRows, lintResult) => {
      // No error, no need to show
      if (!lintResult.getFirstError()) {
        return tableRows
      }

      if (lintResult.getFileLintResults().length === 0) {
        nonTableErrors.push(
          `${fmt.rSep}${lintResult.getMigrationDirectory()}${fmt.rSep}${lintResult.getFirstError() as string}${
            fmt.rSep
          }`
        )
      }

      const rowString: string[] = []
      for (const fileLintResult of lintResult.getFileLintResults()) {
        for (const lintError of fileLintResult.getDiagnostics()) {
          const rowData = [
            // filename
            fileLintResult.getName(),
            // error
            fmt.cEsc(lintError.getMessage()),
            // error code
            lintError.getHelpUrl()
              ? fmt.linkBuilder(lintError.getErrorCode(), lintError.getHelpUrl())
              : lintError.getErrorCode(),
            // position
            lintError.getPosition() >= 0 ? lintError.getPosition() : ''
          ]

          rowString.push(`${fmt.rSep}${rowData.join(fmt.rSep)}${fmt.rSep}`)
        }
      }

      if (rowString.length === 0) {
        return tableRows
      }

      return `${tableRows}\n${rowString.join('\n')}\n`
    }, '')
    let msg = `\n**Lint Errors**\n`
    if (tableRowsStr.length > 0) {
      msg += `${fmt.headerBuilder(['File', 'Error', 'Error Code', 'Position'])}${tableRowsStr}\n`
    }
    if (nonTableErrors.length > 0) {
      msg += `\n**Directory Errors**:\n${fmt.headerBuilder(['Migration Directory', 'Error'])}\n${nonTableErrors.join(
        '\n'
      )}\n`
    }
    return msg
  }

  githubLint(lintResults: LintExecutionResponse[]): string {
    return this.#buildLintMessage(lintResults, formatterMap.github)
  }

  jiraLint(lintResults: LintExecutionResponse[]): string {
    return this.#buildLintMessage(lintResults, formatterMap.jira)
  }

  getFormatter(name: Platform): Formatter {
    return formatterMap[name]
  }

  jiraDescription(comment: string): string {
    return `
    PR Link: ${this.prLink}

    ${comment}
`
  }

  jiraTitle(prefix: string): string {
    return `${prefix}: ${this.prLink}`
  }
}
