const { URL } = require('url')
const artoo = require('artoo-js')
const cheerio = require('cheerio')
const mkdirp = require('./mkdirp')
const Queuer = require('./queuer-observable')
const getLoggerSingleton = require('./logger')
const createDatabase = require('./database')
const createRequester = require('./requester')

// add `.scrape()` helpers to cheerio (html parser)
artoo.bootstrap(cheerio)

const logger = getLoggerSingleton()

// parse a single page view of a meme, and download the media content
const parseMeme = async ({ database, queuer, requester }, pageUri) => {
  try {
    const pageUrl = new URL(`${database.config.baseUrl}${pageUri}`)
    logger.recordStatsFor({ type: 'page' })
    const html = await requester({ url: pageUrl })
    logger.recordStatsFor({ type: 'page', completed: true })

    const meme$ = cheerio.load(html)

    const { dataType, mediaSourceUrl, webmSourceUrl } = meme$('.post > div > .media').scrapeOne({
      dataType: { attr: 'data-type' },
      mediaSourceUrl: { attr: 'data-source' },
      webmSourceUrl: { attr: 'data-webm-source' }
    })

    const tags = meme$('.post .tagpanel__item span')
      .scrape({ tag: 'text' })
      .map(({ tag }) => tag.replace(/^#/, ''))

    if (dataType === 'video') {
      database.assignToEntry(pageUri, {
        tags,
        type: 'video',
        sourceUrl: mediaSourceUrl,
        sourceProviderLocation: meme$('.post .js-media-stopcontrol').scrapeOne({ attr: 'href' }),
        sourceProvider: meme$('.post .media__icon')
          .scrapeOne({ attr: 'class' })
          .replace(/media__icon[_]*/g, '')
          .replace(/\s/g, '')
      })
    } else if (dataType === 'image') {
      database.assignToEntry(pageUri, {
        tags,
        type: 'gif',
        sourceUrl: webmSourceUrl || mediaSourceUrl
      })
    } else {
      database.assignToEntry(pageUri, {
        tags,
        type: 'image',
        sourceUrl: meme$('.post .media__image').scrapeOne({ attr: 'src' })
      })
    }

    // download meme media
    const { sourceUrl, type } = database.get(pageUri)
    const filename = database.getSourceFileDest(pageUri)
    logger.recordStatsFor({ type })
    await requester({ url: new URL(sourceUrl), stream: true, html: false, filename })
    logger.recordStatsFor({ type, completed: true })
    database.assignToEntry(pageUri, { downloaded: true })
  } catch (e) {
    logger.error(database.get(pageUri))
    if (e.message === 'status code: 404') logger.error('handle the 404')
    else throw e
  }
}

// parseGrid parses the several images in html loaded when scrolling past the bottom of the page
const parseGrid = async ({ database, queuer, requester }, batchNumber, batchID) => {
  const { baseUrl, username } = database.config

  const batchUrl =
    batchNumber === 0
      ? new URL(`${baseUrl}/user/${username}`)
      : new URL(
          `${baseUrl}/user/${username}/timeline/${batchID}?batch=${batchNumber + 2}?mode=grid`
        )

  const html = await requester({ url: batchUrl, headers: { 'x-requested-with': 'XMLHttpRequest' } })
  const grid$ = cheerio.load(html)

  const memePageUris = grid$('.post a').scrape({ attr: 'href' })

  for (const pageUri of memePageUris) {
    if (!database.isMemeCached(pageUri)) {
      database.createEntry(pageUri)
      queuer.addTask(() => parseMeme({ database, queuer, requester }, pageUri))
    }
  }
  return grid$('.stream__item').scrapeOne({ attr: 'data-next' })
}

const parseMetaData = async ({ database, requester }) => {
  const { baseUrl, username } = database.config
  const url = new URL(`${baseUrl}/user/${username}`)
  const html = await requester({ url })
  // console.log(html)
  const index$ = cheerio.load(html)
  const memeCountSpan = index$('.metaline__count').scrapeOne()
  const memeCountStr = memeCountSpan
    ? memeCountSpan
        .replace(' memes', '')
        .replace(/K/, '000') // for making 8K become 8000
        .replace(/\.(\d)0/, (_, n) => parseInt(n) + 1) // for making 8.1K become 8200 (cant be certain ifunny doesnt round down)
    : 0

  const memeCount = parseInt(memeCountStr)
  database.setTotalApproximation(memeCount)
}

// move over each batch grid of images until no more remain
const scrape = async ({ database, queuer, requester }) => {
  logger.info(`Saving files to ${database.config.paths.basedir}`)

  logger.info('visiting memer profile...')
  await parseMetaData({ database, queuer, requester })
  // an empty account has no need to be scraped
  if (database.getTotalApproximation() === 0) return

  // batch number & id are part of the html payload that tells ifunny which payload to grab next
  let batchNumber = 0
  let nextBatchID
  do {
    nextBatchID = await parseGrid({ database, queuer, requester }, batchNumber, nextBatchID)
    await database.persist()
    batchNumber++
  } while (nextBatchID)

  logger.debug('done crawling for meme pages.')
  await queuer.toPromise()
  await database.persist()
  logger.info('\ndone downloading memes.')
}

const init = async config => {
  // create save locations
  await mkdirp(config.paths.basedir)
  await mkdirp(config.paths.userdir)
  await mkdirp(config.paths.media)
  await mkdirp(config.paths.cache)
  // create database
  const database = await createDatabase(config)
  // parallel async queue
  const queuer = new Queuer({ maxConcurrent: 10 })
  // cached html/image requester
  const requester = createRequester(config)
  // begin scraping
  await scrape({ database, queuer, requester })
}

module.exports = init
