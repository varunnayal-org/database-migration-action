import {
  DriftRunListResponse,
  Formatter,
  ITextBuilder,
  LintExecutionResponse,
  MigrationRunListResponse
} from '../types'
import * as util from '../util'
import { Platform, formatterMap } from './formatters'

export class TextBuilder {
  dryRun: boolean
  prLink: string
  repoLink: string
  dbDirList: string[]
  platform: Record<Platform, ITextBuilder>
  constructor(dryRun: boolean, prLink: string, repoLink: string, dbDirList: string[]) {
    this.dryRun = dryRun
    this.prLink = prLink
    this.repoLink = repoLink
    this.dbDirList = dbDirList
    this.platform = {
      github: new GithubTextBuilder(this),
      jira: new JiraTextBuilder(this)
    }
  }

  #buildTableAndSQLStatement(fmt: Formatter, response: MigrationRunListResponse): [string, string] {
    let sqlStatementString = ''

    const tableStr = response.executionResponseList.reduce<string>((acc, executionResponseList, idx) => {
      sqlStatementString += `-- DIRECTORY: ${this.dbDirList[idx]}`
      const migrationDirMsg = `${fmt.italic('Directory')}: ${fmt.bold(this.dbDirList[idx])}`
      if (executionResponseList.hasMigrations() === false) {
        sqlStatementString += '\n    -- No migration available\n\n'
        return `${migrationDirMsg}: No migration available\n\n`
      }

      const table = executionResponseList.getExecutedMigrations().reduce<string>(
        (tableRows, version) => {
          const versionErr = version.getVersionError()
          let successfullyExecutedStatementList = version.getAppliedStatements()
          if (versionErr) {
            successfullyExecutedStatementList = successfullyExecutedStatementList.slice(0, -1)
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
   * @param fmt - The Formatter object used for formatting.
   * @returns An array containing the comment message and context string.
   */
  build(response: MigrationRunListResponse, fmt: Formatter): string {
    const printMsgPrefix = this.dryRun ? '[DryRun]Migrations' : 'Migrations'
    let printStatus = 'successful'
    let printEmoji = fmt.success

    let printErrMsg = response.errMsg
    if (!printErrMsg && response.migrationAvailable === false) {
      printErrMsg = 'No migrations available'
    }

    if (printErrMsg) {
      printStatus = 'failed'
      printEmoji = fmt.failure
    }

    const ghActionUrl = `${this.repoLink}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${
      process.env.GITHUB_RUN_ATTEMPT || '1'
    }`

    const lines = [
      `${printEmoji} ${fmt.bold(`${printMsgPrefix} ${printStatus}`)} ${util.readableDate()} ${fmt.linkBuilder(
        'View',
        ghActionUrl
      )}`
    ]

    if (printErrMsg) {
      lines.push(`${fmt.quoteBuilder(printErrMsg)}`)
    }

    if (response.executionResponseList.length > 0) {
      const [table, sqlStatements] = this.#buildTableAndSQLStatement(fmt, response)
      lines.push(table)
      lines.push(fmt.sqlStatementBuilder(sqlStatements))
    }

    return lines.join('\n')
  }

  buildLintMessage(lintResults: LintExecutionResponse[], fmt: Formatter): string {
    const textList = lintResults.reduce<string[]>(
      (textAcc, lintResult) => {
        if (!lintResult.getFirstError()) {
          return textAcc
        }

        textAcc.push(`${fmt.italic('Directory')}: ${fmt.inlineCode(lintResult.getMigrationDirectory())}`)

        if (lintResult.getFileLintResults().length === 0) {
          textAcc.push(`: ${lintResult.getFirstError() as string}`)
          return textAcc
        }

        textAcc.push(fmt.headerBuilder(['Skipped', 'File', 'Error', 'Error Code', 'Position']))

        for (const fileLintResult of lintResult.getFileLintResults()) {
          for (const lintError of fileLintResult.getDiagnostics()) {
            const rowData = [
              // Error skipped?
              lintError.isSkipped() ? fmt.success : fmt.failure,
              // filename
              fileLintResult.getName(),
              // error
              fmt.cEsc(lintError.getMessage() || '-'),
              // error code
              lintError.getHelpUrl()
                ? fmt.linkBuilder(lintError.getErrorCode(), lintError.getHelpUrl())
                : lintError.getErrorCode() || '-',
              // position
              lintError.getPosition() >= 0 ? lintError.getPosition() : '-'
            ]

            textAcc.push(`${fmt.rSep}${rowData.join(fmt.rSep)}${fmt.rSep}`)
          }
        }
        textAcc.push('')
        return textAcc
      },
      [fmt.bold('Lint Errors')]
    )

    return textList.join('\n')
  }

  getFormatter(name: Platform): Formatter {
    return formatterMap[name]
  }

  buildDrift(driftResponse: DriftRunListResponse, fmt: Formatter): string {
    return driftResponse.drifts.reduce<string>((acc, drift, idx) => {
      acc += `\n${fmt.italic('Directory')}: ${fmt.bold(this.dbDirList[idx])}: `
      const errMsg = drift.getError()
      if (errMsg !== undefined) {
        acc += `${fmt.failure} ${fmt.cEsc(errMsg)}`
        return acc
      }

      const driftStatements = drift.getStatements()
      if (driftStatements.length === 0) {
        return (acc += `${fmt.success} No Drift`)
      }

      const sqlStatement = driftStatements.reduce<string[]>((sqlAcc, statement) => {
        sqlAcc.push(`${statement.comment}\n${statement.command}`)
        return sqlAcc
      }, [])

      acc += `${fmt.failure} Drifts present\n${fmt.sqlStatementBuilder(sqlStatement.join('\n'))}\n`
      return acc
    }, '')
  }
}

class JiraTextBuilder implements ITextBuilder {
  constructor(private textBuilder: TextBuilder) {}
  title(prefix: string): string {
    return `${prefix}: ${this.textBuilder.prLink}`
  }

  description(comment: string): string {
    return `
PR Link: ${this.textBuilder.prLink}

${comment}
`
  }

  lint(lintResults: LintExecutionResponse[]): string {
    return this.textBuilder.buildLintMessage(lintResults, formatterMap.jira)
  }

  run(result: MigrationRunListResponse): string {
    return this.textBuilder.build(result, formatterMap.jira)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  drift(drifts: DriftRunListResponse): string {
    return this.textBuilder.buildDrift(drifts, formatterMap.jira)
  }
}

class GithubTextBuilder implements ITextBuilder {
  constructor(private textBuilder: TextBuilder) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  title(prefix: string): string {
    throw new Error('Method not implemented.')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  description(comment: string): string {
    throw new Error('Method not implemented.')
  }

  lint(lintResults: LintExecutionResponse[]): string {
    return this.textBuilder.buildLintMessage(lintResults, formatterMap.github)
  }

  run(result: MigrationRunListResponse): string {
    return this.textBuilder.build(result, formatterMap.github)
  }

  drift(drifts: DriftRunListResponse): string {
    return this.textBuilder.buildDrift(drifts, formatterMap.github)
  }
}
