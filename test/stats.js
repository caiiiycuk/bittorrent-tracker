import Client from '../index.js'
import commonTest from './common.js'
import fixtures from 'webtorrent-fixtures'
import fetch from 'cross-fetch-ponyfill'
import test from 'tape'

const peerId = Buffer.from('-WW0091-4ea5886ce160')
const unknownPeerId = Buffer.from('01234567890123456789')

function parseHtml (html) {
  const h1 = html.match(/<h1>(\d+) torrents \((\d+) active\)<\/h1>/)
  const peersAll = html.match(/Connected Peers: (\d+)/)
  const peersSeederOnly = html.match(/Peers Seeding Only: (\d+)/)
  const peersLeecherOnly = html.match(/Peers Leeching Only: (\d+)/)
  const peersSeederAndLeecher = html.match(/Peers Seeding &amp; Leeching: (\d+)/)
  const peersIPv4 = html.match(/IPv4 Peers: (\d+)/)
  const peersIPv6 = html.match(/IPv6 Peers: (\d+)/)
  return {
    torrents: h1 ? parseInt(h1[1], 10) : null,
    activeTorrents: h1 ? parseInt(h1[2], 10) : null,
    peersAll: peersAll ? parseInt(peersAll[1], 10) : null,
    peersSeederOnly: peersSeederOnly ? parseInt(peersSeederOnly[1], 10) : null,
    peersLeecherOnly: peersLeecherOnly ? parseInt(peersLeecherOnly[1], 10) : null,
    peersSeederAndLeecher: peersSeederAndLeecher ? parseInt(peersSeederAndLeecher[1], 10) : null,
    peersIPv4: peersIPv4 ? parseInt(peersIPv4[1], 10) : null,
    peersIPv6: peersIPv6 ? parseInt(peersIPv6[1], 10) : null
  }
}

test('server: get empty stats', t => {
  t.plan(10)

  commonTest.createServer(t, 'http', async (server, announceUrl) => {
    const url = announceUrl.replace('/announce', '/stats')

    let res
    try {
      res = await fetch(url)
    } catch (err) {
      t.error(err)
    }
    const data = Buffer.from(await res.arrayBuffer())

    const stats = parseHtml(data.toString())
    t.equal(res.status, 200)
    t.equal(stats.torrents, 0)
    t.equal(stats.activeTorrents, 0)
    t.equal(stats.peersAll, 0)
    t.equal(stats.peersSeederOnly, 0)
    t.equal(stats.peersLeecherOnly, 0)
    t.equal(stats.peersSeederAndLeecher, 0)
    t.equal(stats.peersIPv4, 0)
    t.equal(stats.peersIPv6, 0)

    server.close(() => { t.pass('server closed') })
  })
})

test('server: get empty stats with json header', t => {
  t.plan(10)

  commonTest.createServer(t, 'http', async (server, announceUrl) => {
    const opts = {
      url: announceUrl.replace('/announce', '/stats'),
      headers: {
        accept: 'application/json'
      }
    }
    let res
    try {
      res = await fetch(announceUrl.replace('/announce', '/stats'), opts)
    } catch (err) {
      t.error(err)
    }
    const stats = await res.json()

    t.equal(res.status, 200)
    t.equal(stats.torrents, 0)
    t.equal(stats.activeTorrents, 0)
    t.equal(stats.peersAll, 0)
    t.equal(stats.peersSeederOnly, 0)
    t.equal(stats.peersLeecherOnly, 0)
    t.equal(stats.peersSeederAndLeecher, 0)
    t.equal(stats.peersIPv4, 0)
    t.equal(stats.peersIPv6, 0)

    server.close(() => { t.pass('server closed') })
  })
})

test('server: get empty stats on stats.json', t => {
  t.plan(10)

  commonTest.createServer(t, 'http', async (server, announceUrl) => {
    let res
    try {
      res = await fetch(announceUrl.replace('/announce', '/stats.json'))
    } catch (err) {
      t.error(err)
    }
    const stats = await res.json()

    t.equal(res.status, 200)
    t.equal(stats.torrents, 0)
    t.equal(stats.activeTorrents, 0)
    t.equal(stats.peersAll, 0)
    t.equal(stats.peersSeederOnly, 0)
    t.equal(stats.peersLeecherOnly, 0)
    t.equal(stats.peersSeederAndLeecher, 0)
    t.equal(stats.peersIPv4, 0)
    t.equal(stats.peersIPv6, 0)

    server.close(() => { t.pass('server closed') })
  })
})

test('server: get leecher stats.json', t => {
  t.plan(10)

  commonTest.createServer(t, 'http', (server, announceUrl) => {
    // announce a torrent to the tracker
    const client = new Client({
      infoHash: fixtures.leaves.parsedTorrent.infoHash,
      announce: announceUrl,
      peerId,
      port: 6881
    })
    client.on('error', err => { t.error(err) })
    client.on('warning', err => { t.error(err) })

    client.start()

    server.once('start', async () => {
      let res
      try {
        res = await fetch(announceUrl.replace('/announce', '/stats.json'))
      } catch (err) {
        t.error(err)
      }
      const stats = await res.json()

      t.equal(res.status, 200)
      t.equal(stats.torrents, 1)
      t.equal(stats.activeTorrents, 1)
      t.equal(stats.peersAll, 1)
      t.equal(stats.peersSeederOnly, 0)
      t.equal(stats.peersLeecherOnly, 1)
      t.equal(stats.peersSeederAndLeecher, 0)
      t.equal(stats.clients.WebTorrent['0.91'], 1)

      client.destroy(() => { t.pass('client destroyed') })
      server.close(() => { t.pass('server closed') })
    })
  })
})

test('server: get leecher stats.json (unknown peerId)', t => {
  t.plan(10)

  commonTest.createServer(t, 'http', (server, announceUrl) => {
    // announce a torrent to the tracker
    const client = new Client({
      infoHash: fixtures.leaves.parsedTorrent.infoHash,
      announce: announceUrl,
      peerId: unknownPeerId,
      port: 6881
    })
    client.on('error', err => { t.error(err) })
    client.on('warning', err => { t.error(err) })

    client.start()

    server.once('start', async () => {
      let res
      try {
        res = await fetch(announceUrl.replace('/announce', '/stats.json'))
      } catch (err) {
        t.error(err)
      }
      const stats = await res.json()

      t.equal(res.status, 200)
      t.equal(stats.torrents, 1)
      t.equal(stats.activeTorrents, 1)
      t.equal(stats.peersAll, 1)
      t.equal(stats.peersSeederOnly, 0)
      t.equal(stats.peersLeecherOnly, 1)
      t.equal(stats.peersSeederAndLeecher, 0)
      t.equal(stats.clients.unknown['01234567'], 1)

      client.destroy(() => { t.pass('client destroyed') })
      server.close(() => { t.pass('server closed') })
    })
  })
})

test('server: stats include torrentName for each infoHash', t => {
  t.plan(8)

  commonTest.createServer(t, 'http', (server, announceUrl) => {
    const infoHash = fixtures.leaves.parsedTorrent.infoHash
    const torrentName = 'torrents/leaves.torrent'

    const client = new Client({
      infoHash,
      announce: announceUrl,
      peerId,
      port: 6881
    })
    client.on('error', err => { t.error(err) })
    client.on('warning', err => { t.error(err) })

    client.start()

    server.once('start', async () => {
      server._torrentNamesMap[infoHash] = torrentName
      server._torrentNamesUpdatedAt = Date.now()

      let jsonRes
      let htmlRes
      try {
        jsonRes = await fetch(announceUrl.replace('/announce', '/stats.json'))
        htmlRes = await fetch(announceUrl.replace('/announce', '/stats'))
      } catch (err) {
        t.error(err)
      }

      const stats = await jsonRes.json()
      const html = await htmlRes.text()
      const detail = stats.torrentDetails.find(x => x.infoHash === infoHash)

      t.equal(jsonRes.status, 200)
      t.ok(detail, 'torrent details should include infoHash entry')
      t.equal(detail.infoHash, infoHash, 'infoHash should match torrent details entry')
      t.equal(detail.torrentName, torrentName, 'torrentName should be present in stats.json')
      t.equal(htmlRes.status, 200)
      t.ok(html.includes(infoHash), 'stats html should include infoHash')
      t.ok(html.includes(`(${torrentName})`), 'stats html should include torrentName near infoHash')

      client.destroy(() => { t.pass('client destroyed') })
      server.close(() => {})
    })
  })
})
