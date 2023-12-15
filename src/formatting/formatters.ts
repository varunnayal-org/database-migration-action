import { Formatter } from '../types'

export type Platform = 'github' | 'jira'

/**
 * A map of formatters for different platforms.
 */
export const formatterMap: Record<Platform, Formatter> = {
  github: {
    success: '✅',
    failure: '❌',
    hSep: '|',
    rSep: '|',
    cEsc: function githubColumnValueEscape(column: string): string {
      // convert '|' to '\|'
      const regex = new RegExp(`\\${this.rSep}`, 'g')
      return column.replace(regex, `\\${this.rSep}`)
    },
    headerBuilder: function githubHeaders(headers: string[]): string {
      let headerRow = this.hSep
      let secondRow = this.hSep
      for (const header of headers) {
        headerRow += ` ${header} ${this.hSep}`
        secondRow += ' --- |'
      }
      return `${headerRow}\n${secondRow}`
    },
    userRef: (login: string) => `@${login}`,
    linkBuilder: (text: string, url: string): string => `[${text}](${url})`,
    quoteBuilder: (text: string) => `> ${text}\n`,
    sqlStatementBuilder: (text: string, header?: string) =>
      `<details><summary>${header || 'SQL Statements'}</summary>\n\n\`\`\`sql\n${text}\n\`\`\`\n</details>`
  },
  jira: {
    success: '(/)',
    failure: '(x)',
    hSep: '||',
    rSep: '|',
    cEsc: column => column, // could not find anything for jira
    headerBuilder: function jiraHeaders(headers: string[]): string {
      return `${this.hSep}${headers.join(this.hSep)}${this.hSep}`
    },
    userRef(login: string) {
      return this.linkBuilder(login, `https://github.com/${login}`)
    },
    linkBuilder: (text: string, url: string): string => `[${text}|${url}]`,
    quoteBuilder: (text: string) => `{quote}\n${text}\n{quote}`,
    sqlStatementBuilder: (text: string, header?: string) =>
      `{code:title=${header || 'SQL Statements'}|borderStyle=solid}\n${text}\n{code}`
  }
}
