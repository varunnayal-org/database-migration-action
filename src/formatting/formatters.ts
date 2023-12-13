import { Formatter } from '../types'

/**
 * A map of formatters for different platforms.
 */
export const formatterMap: Record<string, Formatter> = {
  github: {
    success: '✅',
    failure: '❌',
    hSep: '|',
    rSep: '|',
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
    sqlStatementBuilder: (text: string, header?: string) =>
      `<details><summary>${header || 'SQL Statements'}</summary>\n\n\`\`\`sql\n${text}\n\`\`\`\n</details>`
  },
  jira: {
    success: '(/)',
    failure: '(x)',
    hSep: '||',
    rSep: '|',
    headerBuilder: function jiraHeaders(headers: string[]): string {
      return `${this.hSep}${headers.join(this.hSep)}${this.hSep}`
    },
    userRef(login: string) {
      return this.linkBuilder(login, `https://github.com/${login}`)
    },
    linkBuilder: (text: string, url: string): string => `[${text}|${url}]`,
    sqlStatementBuilder: (text: string, header?: string) =>
      `{code:title=${header || 'SQL Statements'}|borderStyle=solid}\n${text}\n{code}`
  }
}
