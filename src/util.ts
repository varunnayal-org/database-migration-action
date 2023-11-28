import * as core from '@actions/core'
import { spawn } from 'child_process'
import fs from 'fs'
import { MigrationResponse } from './types'

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

function getFileListingForComment(migrationFileListByDirectory: MigrationResponse[], dbDirList: string[]): string {
  return migrationFileListByDirectory
    .reduce<string[]>(
      (acc, response, idx) => {
        acc.push(`- Directory: **'${dbDirList[idx]}'**`)
        if (response.response === '') {
          acc.push('  Files: NA')
        } else {
          acc.push(`\`\`\`\n${response.response}\n\`\`\``)
        }
        return acc
      },
      ['']
    )
    .join('\r\n')
}

async function exec(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Spawn the process
    const process = spawn(command, args)

    let output = ''

    // Collect data from stdout
    process.stdout.on('data', data => {
      output += data.toString()
    })

    // Collect data from stderr
    process.stderr.on('data', data => {
      output += data.toString()
    })

    // Handle process errors (e.g., command not found)
    process.on('error', error => {
      reject(error)
    })

    // Resolve the promise when the process exits
    process.on('close', code => {
      output = output.trim()
      core.debug(`Command: ${command} ${args.join(' ')}\n\tcode=${code} output=${output}`)
      if (code === 0) {
        resolve(output)
      } else {
        let errMsg = `Process "${command} ${args.join(' ')}" exited with code ${code}`
        if (output) {
          errMsg += `\n${output}`
        }
        reject(new Error(errMsg))
      }
    })
  })
}

export { createTempDir, removeDir, cleanDir, getEnv, getInput, commentBuilder, getFileListingForComment, exec }
