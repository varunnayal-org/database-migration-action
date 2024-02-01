import { run } from '../src/main'
import * as util from '../src/util'
import * as c from './common'

const processDriftFn = jest.fn().mockResolvedValue(1)
const mapIssueToPullRequestFn = jest.fn()
const processEventFn = jest.fn().mockResolvedValue(2)
const initFn = jest.fn()
const skipProcessingHandlerFn = jest.fn()

jest.mock('../src/migration.service', () => {
  return jest.fn().mockImplementation(() => {
    return {
      processDrift: processDriftFn,
      mapIssueToPullRequest: mapIssueToPullRequestFn,
      processEvent: processEventFn,
      init: initFn,
      skipProcessingHandler: skipProcessingHandlerFn
    }
  })
})

jest.mock('../src/factory', () => {
  return {
    getVault: jest.fn().mockReturnValue({}),
    getJira: jest.fn().mockReturnValue({}),
    getGithub: jest.fn().mockReturnValue({}),
    getNotifier: jest.fn().mockImplementation(() => {
      throw new Error('Method getNotifier should not be called')
    })
  }
})

jest.mock('../src/config', () =>
  jest.fn().mockImplementation(() => {
    return {}
  })
)

afterAll(() => {
  jest.resetModules()
})

describe('run', () => {
  let getContext: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    getContext = jest.spyOn(util, 'getContext')
  })

  it('should run on schedule', async () => {
    const event = { eventName: 'schedule', a: 1, b: 2 }
    getContext.mockReturnValue(event)

    await run()

    expect(processDriftFn).toHaveBeenCalledTimes(1)
    expect(processDriftFn).toHaveBeenCalledWith(event)
  })

  it('should run on issue_comment', async () => {
    const event = c.getPRCommentContext({
      action: 'created',
      comment: c.getComment(212121, 'jira', 'user-ddd'),
      issue: c.getPR(['user-aaa', 'user-bbb'], ['db-migration']),
      organization: {
        login: 'my-org'
      },
      repository: c.getRepo(),
      sender: c.user('user-aaa')
    })

    getContext.mockReturnValue(event)

    await run()

    expect(mapIssueToPullRequestFn).toHaveBeenCalledTimes(1)
    expect(mapIssueToPullRequestFn).toHaveBeenCalledWith(event.payload.issue)
    expect(initFn).toHaveBeenCalledTimes(1)
    expect(initFn).toHaveBeenCalledWith('my-org', 'my-org', 'calc-svc')
    expect(processEventFn).toHaveBeenCalledTimes(1)
    expect(processEventFn).toHaveBeenCalledWith(event)
  })

  const tcs = [
    [
      'pull_request_review',
      c.getPRReviewContext({
        action: 'submitted',
        organization: {
          login: 'my-org'
        },
        pull_request: c.getPR(['user-aaa', 'user-bbb'], ['db-migration']),
        repository: c.getRepo(),
        review: c.getReview('user-aaa', 1111111),
        sender: {
          login: 'user-bbb',
          type: 'User'
        }
      })
    ],
    [
      'pull_request',
      c.getPRContext({
        action: 'opened',
        after: 'xxxxx',
        before: 'aaaaaa',
        number: 1,
        organization: {
          login: 'my-org'
        },
        pull_request: c.getPR(['user-aaa', 'user-bbb'], ['db-migration']),
        repository: c.getRepo(),
        sender: c.user('user-aaa')
      })
    ]
  ]

  for (const tc of tcs) {
    const [eventName, event] = tc
    it(`should run on ${eventName}`, async () => {
      getContext.mockReturnValue(event)

      await run()

      expect(initFn).toHaveBeenCalledTimes(1)
      expect(initFn).toHaveBeenCalledWith('my-org', 'my-org', 'calc-svc')
      expect(processEventFn).toHaveBeenCalledTimes(1)
      expect(processEventFn).toHaveBeenCalledWith(event)
    })
  }

  describe('error', () => {
    it('should throw error if schedule processing fails', async () => {
      const event = { eventName: 'schedule', a: 1, b: 2 }
      getContext.mockReturnValue(event)
      processDriftFn.mockRejectedValue(new Error('some unknown error'))

      await expect(run()).rejects.toThrow('some unknown error')
      expect(processDriftFn).toHaveBeenCalledTimes(1)
      expect(processDriftFn).toHaveBeenCalledWith(event)
    })
    for (const tc of tcs) {
      const [eventName, event] = tc
      it(`should throw error if ${eventName} processing fails`, async () => {
        getContext.mockReturnValue(event)
        processEventFn.mockRejectedValue(new Error('some processing error'))

        await expect(run()).rejects.toThrow('some processing error')

        expect(initFn).toHaveBeenCalledTimes(1)
        expect(initFn).toHaveBeenCalledWith('my-org', 'my-org', 'calc-svc')
        expect(processEventFn).toHaveBeenCalledTimes(1)
        expect(processEventFn).toHaveBeenCalledWith(event)
      })
    }

    it('should skip on unwanted event', async () => {
      getContext.mockReturnValue({ eventName: 'unwanted_event' })

      await run()

      expect(skipProcessingHandlerFn).toHaveBeenCalledWith('unwanted_event', { action: 'na' })
    })
  })
})
