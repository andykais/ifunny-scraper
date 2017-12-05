/* eslint-disable no-multiple-empty-lines */

const { promisify } = require('util')
const { readFile, writeFile, createWriteStream, mkdir: mkdirCB } = require('fs')
const { relative, basename } = require('path')
const artoo = require('artoo-js')
const cheerio = require('cheerio')
const request = require('request')
const chalk = require('chalk')
const Queuer = require('./queuer-observable')
// define constants
const cacheFolder = `${__dirname}/cache`
const DEBUG = process.env.DEBUG === 'true'

// set up listeners
process.on('unhandledRejection', (err) => console.error(err))

// assemble promise utilities
const [ read, write, mkdir ] = [ readFile, writeFile, mkdirCB ].map(f => promisify(f))
const rp = (options = {}) => new Promise((resolve, reject) =>
      request(options, (error, { statusCode } = {}, body) => {
        if (error) reject(error)
        else if (![200, 302].includes(statusCode)) reject(new Error(`status code: ${statusCode} at ${options.url}`))
        else resolve(body)
      }))
const cacheRP = async (options = {}) => {
  const filename = `${cacheFolder}/${sanitizeFilename(options.url)}.html`
  try {
    const html = await read(filename)
    debug(chalk.green(`accessed saved ${relative(__dirname, filename)}`))
    return html.toString()
  } catch (e) {
    const blob = await rp(options)
    debug(chalk.yellow(`requested page ${relative(__dirname, filename)}`))
    await write(filename, blob)
    return blob.toString()
  }
}

// define regular utilities
const sanitizeFilename = s => s.replace(/[^a-z0-9]/gi, '_')

const debug = (...args) => DEBUG && console.log('>', ...args, '\n')

class DownloadLog {
  constructor () {
    this.downloaded = 0
    this.remaining = {
      video: 0,
      image: 0,
      cached: 0,
      page: 0
    }
    this.total = 0
  }
  log () {
    const logMessage = `downloaded ${this.downloaded} memes (${this.remaining.image} images & ${this.remaining.video} videos queued) while ${this.remaining.page} pages are downloading.`
    if (DEBUG) console.log(logMessage)
    else process.stdout.write(`\r${logMessage}`)
  }

  startedDownload (type) {
    if (['video', 'image', 'cached'].includes(type)) this.total++
    this.remaining[type]++
    this.log()
  }
  finishedDownload (type) {
    if (['video', 'image', 'cached'].includes(type)) this.downloaded++
    this.remaining[type]--
    this.log()
  }
}
const log = new DownloadLog()

const downloadMeme = async (meme) => {
  const { sourceFile, type, index } = meme
  log.startedDownload(type)
  const filename = `memes/${index.toString().padStart(4, 0)}-${basename(sourceFile)}`
  await new Promise((resolve, reject) => request(sourceFile).pipe(createWriteStream(filename)).on('close', resolve))
  meme.downloaded = true
  log.finishedDownload(type)
}

const parseMeme = async (memeEntry) => {
  try {
    log.startedDownload('page')
    const html = await cacheRP({ url: `https://ifunny.co${memeEntry.page}` })
    log.finishedDownload('page')
    const meme$ = cheerio.load(html)
    const dataType = meme$('.post > div > .media').scrape({ attr: 'data-type' })[0] || 'image'
    const { type, sourceFile, sourceLocation, sourceProvider } = (() => {
      const { sourceFile, webmSource } = meme$('.post > div > .media').scrape({ sourceFile: { attr: 'data-source' }, webmSource: { attr: 'data-webm-source' } })[0]
      if (dataType === 'video') {
        return {
          sourceFile: meme$('.post > div > .media').scrape({ attr: 'data-source' })[0],
          sourceLocation: meme$('.post .js-media-stopcontrol').scrape({ attr: 'href' })[0],
          sourceProvider: meme$('.post .media__icon').scrape({ attr: 'class' })[0].replace(/media__icon[_]*/g, '').replace(/\s/g, ''),
          type: dataType
        }
      }
      if (sourceFile) {
        return {
          sourceFile: webmSource || sourceFile,
          type: 'gif'
        }
      } else {
        return {
          sourceFile: meme$('.post .media__preview').scrape({ sel: 'img', attr: 'src' })[0],
          type: 'image'
        }
      }
    })()

    if (sourceProvider && !['instagram', 'coub', 'play_large', 'vine'].includes(sourceProvider)) {
      throw new Error(`unhandled video type "${sourceProvider}" from (${meme$('.post .media__icon').scrape({ attr: 'class' })[0]}) at ${memeEntry.page}`)
    }
    const tags = meme$('.post .tagpanel__item span').scrape({ tag: 'text' }).map(({ tag }) => tag.replace(/^#/, ''))

    memeEntry.type = type
    memeEntry.tags = tags
    memeEntry.sourceFile = sourceFile
    memeEntry.sourceProvider = sourceProvider
    memeEntry.sourceLocation = sourceLocation
    memeEntry.index = log.total

    await downloadMeme(memeEntry)
  } catch (e) {
    console.error(memeEntry)
    if (e.message === 'status code: 404') console.log('handle the 404')
    else throw e
  }
}

const parseGrid = async (database, existingMemes, queuer, batchID, memeNumber, profile) => {
  const batchUrl = batchID
    ? `https://ifunny.co/${profile}/timeline/${batchID}?batch=${memeNumber + 2}?mode=grid`
    : `https://ifunny.co/${profile}`
  const html = await cacheRP({ url: batchUrl, headers: { 'x-requested-with': 'XMLHttpRequest' } })
  const grid$ = cheerio.load(html)
  const memePages = grid$('.post a').scrape({ attr: 'href' })

  for (const page of memePages) {
    if (existingMemes[page] && existingMemes[page].downloaded) {
      log.finishedDownload('cached')
    } else {
      const memeEntry = {
        page,
        downloaded: false,
        tags: [],
        batchID
      }
      database.entries.push(memeEntry)

      // manipulates memeEntry
      queuer.addTask(() => parseMeme(memeEntry))
    }
    // break
  }
  return grid$('.stream__item').scrape({ attr: 'data-next' })[0]
}

const scrape = async ({ profile, queuer, database, paths }) => {
  console.log(`Saving files to ${paths.basedir}`)
  let memeNumber = 0
  const { entries = [] } = database
  database.entries = entries
  const existingMemes = entries.reduce((acc, m) => {
    acc[m.page] = m
    return acc
  }, {})

  console.log('visiting memer profile...')

  let nextBatch = await parseGrid(database, existingMemes, queuer, undefined, memeNumber, profile)

  while (nextBatch) {
    nextBatch = await parseGrid(database, existingMemes, queuer, nextBatch, memeNumber, profile)
    await write(paths.database, JSON.stringify({ entries }, null, 2))
    // break
    memeNumber++
  }
  debug('done crawling for memes.')

  await queuer.toPromise()
  await write(paths.database, JSON.stringify({ entries }, null, 2))

  console.log('\ndone downloading memes.')
}

const init = async ({ profile, save }) => {
  // html parser
  artoo.bootstrap(cheerio)
  // save locations
  const paths = {
    basedir: save(),
    database: save('meme_database.json'),
    media: save('memes'),
    cache: save('cache')
  }
  // create or load the json 'database'
  const database = await (async () => { try { return JSON.parse(await read(paths.database)) } catch (e) { return {} } })()
  // mkdir -p
  try {
    await mkdir(paths.basedir)
    await mkdir(paths.media)
    await mkdir(paths.cache)
  } catch (_) {}
  // parallel async queue
  const queuer = new Queuer({ maxConcurrent: 10 })
  // begin scraping
  await scrape({ profile, database, paths, queuer })
}

module.exports = init
