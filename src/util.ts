import * as core from '@actions/core'
import fs from 'fs'

export type CommentBuilderHandler = (boldText: string, msg?: string) => string

async function cleanDir(dirName: string): Promise<void> {
  try {
    await fs.promises.rm(dirName, { recursive: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: NodeJS.ErrnoException | any) {
    if (ex.code !== 'ENOENT') {
      throw ex
    }
  }
}

async function createTempDir(dirName: string): Promise<string> {
  await fs.promises.mkdir(dirName, { recursive: true })
  return dirName
}

async function removeDir(dirName: string): Promise<void> {
  core.debug(`Removing Dir: ${dirName}`)
  if (dirName) {
    fs.promises.rm(dirName, { recursive: true })
  }
}

function getEnv(envName: string, fromState: NodeJS.ProcessEnv = process.env): string {
  const value = fromState[envName]
  if (typeof value === 'undefined') {
    throw new Error(`Environment variable ${envName} is not set`)
  }
  return value
}

function getInput(name: string, defaultValue?: string): string {
  const value = core.getInput(name)
  if (value !== '') {
    return value
  }
  if (defaultValue === undefined) {
    throw new Error(`Input ${name} is not set`)
  }
  return defaultValue
}

function readableDate(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Calcutta'
  })
}

function commentBuilder(msgPrefix: string, htmlURL: string, isJiraEvent: boolean): CommentBuilderHandler {
  return (boldText: string, msg?: string): string => {
    let returnMsg = `**${msgPrefix} ${boldText}** ${readableDate()} (${buildExecutionMarkdown(htmlURL, isJiraEvent)})`
    if (msg) {
      returnMsg = `${returnMsg}: ${msg}`
    }
    return returnMsg
  }
}

function buildExecutionMarkdown(htmlURL: string, isJiraEvent: boolean): string {
  const executionURL = `${htmlURL}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`
  if (isJiraEvent !== true) {
    return `[Execution](${executionURL})`
  }
  return `[Execution|${executionURL}]`
}

function getFileListingForComment(migrationFileListByDirectory: string[][], dbDirList: string[]): string {
  return migrationFileListByDirectory
    .reduce((acc, fileList, idx) => {
      acc.push(`Directory: '${dbDirList[idx]}'`)
      if (fileList.length === 0) {
        acc.push('  Files: NA')
        return acc
      }
      acc.push('  Files:')
      for (const file of fileList) {
        acc.push(`- ${file}`)
      }
      return acc
    }, [])
    .join('\r\n')
}

export { createTempDir, removeDir, cleanDir, getEnv, getInput, commentBuilder, getFileListingForComment }
