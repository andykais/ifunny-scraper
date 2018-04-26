const { createWriteStream, readFile, writeFile } = require('fs')
const os = require('os')
const { relative, resolve, extname } = require('path')
const request = require('request')
const chalk = require('chalk')
const { promisify } = require('util')
const getLoggerSingleton = require('./logger')

const [read, write] = [readFile, writeFile].map(f => promisify(f))

const sanitizeNameForFilesystem = s => s.replace(/[^a-z0-9]/gi, '_')

const logger = getLoggerSingleton()

const { inspect } = require('util')

const requestPromise = (options = {}) =>
  new Promise((resolve, reject) =>
    request(options, (error, { statusCode } = {}, body) => {
      if (error) {
        reject(error)
      } else if (![200].includes(statusCode)) {
        reject(new Error(`status code: ${statusCode} at ${options.url}`))
      } else {
        resolve(body)
      }
    })
  )

// request promise with the ability to cache a file
const cachedRequestPromise = config => async options => {
  const { filename, index, stream, html = true, ...requestOptions } = options
  const destFilename = filename || `${config.paths.cache}/${sanitizeNameForFilesystem(options.url.toString())}`

  if (stream) {
    await new Promise((resolve, reject) => {
      logger.debug('stream', { destFilename, html, stream })
      request(requestOptions)
        .pipe(createWriteStream(destFilename))
        .on('close', resolve)
    })
  } else {
    try {
      const cached = await read(destFilename)
      logger.debug(chalk.green(`accessed saved ${relative(config.paths.basedir, destFilename)}`))
      return cached.toString()
    } catch (e) {
      const blob = await requestPromise(requestOptions)
      logger.debug(chalk.yellow(`requested page ${requestOptions.url}`))
      await write(destFilename, blob)
      return blob.toString()
    }
  }
}

module.exports = cachedRequestPromise
