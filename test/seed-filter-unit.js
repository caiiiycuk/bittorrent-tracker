/**
 * Unit test for peer selection in _getPeers.
 * Run: node test/seed-filter-unit.js
 */
import Swarm from '../lib/server/swarm.js'

const infoHash = 'a'.repeat(40)

function createMockServer () {
  return {
    peersCacheLength: 100,
    peersCacheTtl: 60000
  }
}

function addPeer (swarm, peerId, type = 'ws') {
  swarm.announce({
    type,
    event: 'started',
    peer_id: peerId,
    left: 100,
    ip: '127.0.0.1',
    port: 6881,
    numwant: 0,
    socket: type === 'ws' ? { infoHashes: [], destroyed: false } : undefined
  }, () => {})
}

function addHttpPeer (swarm, peerId, port) {
  swarm.announce({
    type: 'http',
    event: 'started',
    peer_id: peerId,
    left: 100,
    ip: '127.0.0.1',
    port,
    addr: `127.0.0.1:${port}`,
    numwant: 0
  }, () => {})
}

function test (name, fn) {
  try {
    fn()
    console.log(`  PASS: ${name}`)
  } catch (e) {
    console.error(`  FAIL: ${name}: ${e.message}`)
    process.exitCode = 1
  }
}

function assert (cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

console.log('_getPeers unit tests')

test('returns requested number of WebRTC peers', () => {
  const server = createMockServer()
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 10; i++) addPeer(swarm, `peer${i}`, 'ws')
  const peers = swarm._getPeers(5, 'requestor', true)
  assert(peers.length === 5, `expected 5 peers, got ${peers.length}`)
})

test('WebRTC excludes requestor peer', () => {
  const server = createMockServer()
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'requestor', 'ws')
  addPeer(swarm, 'peerB', 'ws')

  const peers = swarm._getPeers(2, 'requestor', true)
  assert(peers.length === 1, `expected 1 peer, got ${peers.length}`)
  assert(peers[0].peerId === 'peerB', 'requestor peer should be excluded')
})

test('WebRTC path does not return HTTP peers', () => {
  const server = createMockServer()
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'ws-peer', 'ws')
  addHttpPeer(swarm, 'http-peer', 60001)

  const peers = swarm._getPeers(2, 'requestor', true)
  assert(peers.length === 1, `expected 1 peer, got ${peers.length}`)
  assert(peers[0].peerId === 'ws-peer', 'WebRTC should only receive websocket peers')
})

test('HTTP/UDP path does not return websocket peers', () => {
  const server = createMockServer()
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'ws-peer', 'ws')
  addHttpPeer(swarm, 'http-peer', 60001)

  const peers = swarm._getPeers(2, 'requestor', false)
  assert(peers.length === 1, `expected 1 peer, got ${peers.length}`)
  assert(peers[0].peerId === 'http-peer', 'HTTP/UDP should only receive http/udp peers')
})

console.log('All _getPeers unit tests complete')
