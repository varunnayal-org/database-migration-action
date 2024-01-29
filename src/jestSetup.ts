import * as core from '@actions/core'

jest.spyOn(core, 'debug').mockImplementation(jest.fn())
jest.spyOn(core, 'info').mockImplementation(jest.fn())
jest.spyOn(core, 'error').mockImplementation(jest.fn())
jest.spyOn(core, 'setOutput').mockImplementation(jest.fn())
jest.spyOn(core, 'setFailed').mockImplementation(jest.fn())

jest.spyOn(core.summary, 'addRaw').mockImplementation(jest.fn())
jest.spyOn(core.summary, 'write').mockImplementation(jest.fn())
