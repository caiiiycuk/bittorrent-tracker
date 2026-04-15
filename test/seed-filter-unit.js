/**
 * Unit test for disabled seeders filtering in _getPeers.
 * Run: node test/seed-filter-unit.js
 */
import Swarm from '../lib/server/swarm.js'

const infoHash = 'a'.repeat(40)

function createMockServer (seedFilterEnabled, disabledSeedersMap) {
  return {
    peersCacheLength: 100,
    peersCacheTtl: 60000,
    _seedFilterEnabled: seedFilterEnabled,
    _disabledSeedersMap: disabledSeedersMap
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

console.log('Disabled seeders filter unit tests')

test('no filter: returns all peers randomly', () => {
  const server = createMockServer(false, {})
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 10; i++) addPeer(swarm, `peer${i}`, 'ws')
  const peers = swarm._getPeers(5, 'requestor', true)
  assert(peers.length === 5, `expected 5 peers, got ${peers.length}`)
})

test('filter enabled but no disabled map for this infoHash: returns all peers', () => {
  const server = createMockServer(true, {})
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 10; i++) addPeer(swarm, `peer${i}`, 'ws')
  const peers = swarm._getPeers(5, 'requestor', true)
  assert(peers.length === 5, `expected 5 peers, got ${peers.length}`)
})

test('filter: WebRTC skips disabled peers', () => {
  const disabledMap = {}
  disabledMap[infoHash] = {
    peers: ['peer1', 'peer3'],
    peersSet: new Set(['peer1', 'peer3']),
    torrentId: 't-1'
  }
  const server = createMockServer(true, disabledMap)
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 5; i++) addPeer(swarm, `peer${i}`, 'ws')

  const peers = swarm._getPeers(3, 'requestor', true)
  assert(peers.length === 3, `expected 3 peers, got ${peers.length}`)
  for (const peer of peers) {
    assert(peer.peerId !== 'peer1' && peer.peerId !== 'peer3', 'disabled peer should not be returned')
  }
})

test('filter: WebRTC returns fewer peers when many are disabled', () => {
  const disabledMap = {}
  disabledMap[infoHash] = {
    peers: ['peer1', 'peer2'],
    peersSet: new Set(['peer1', 'peer2']),
    torrentId: 't-2'
  }
  const server = createMockServer(true, disabledMap)
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 3; i++) addPeer(swarm, `peer${i}`, 'ws')

  const peers = swarm._getPeers(3, 'requestor', true)
  assert(peers.length === 1, `expected 1 peer, got ${peers.length}`)
  assert(peers[0].peerId === 'peer0', 'returned peer should be eligible')
})

test('filter: WebRTC excludes requestor peer even if not disabled', () => {
  const disabledMap = {}
  const server = createMockServer(true, disabledMap)
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'requestor', 'ws')
  addPeer(swarm, 'peerB', 'ws')

  const peers = swarm._getPeers(2, 'requestor', true)
  assert(peers.length === 1, `expected 1 peer, got ${peers.length}`)
  assert(peers[0].peerId === 'peerB', 'requestor peer should be excluded')
})

test('filter: HTTP/UDP announce path does not apply disabled seeders filter', () => {
  const disabledMap = {}
  disabledMap[infoHash] = {
    peers: ['bad'],
    peersSet: new Set(['bad']),
    torrentId: 't-3'
  }
  const server = createMockServer(true, disabledMap)
  const swarm = new Swarm(infoHash, server)
  addHttpPeer(swarm, 'good', 60001)
  addHttpPeer(swarm, 'bad', 60002)
  let sawBad = false
  let sawGood = false
  for (let i = 0; i < 120; i++) {
    const peers = swarm._getPeers(1, 'requestor', false)
    assert(peers.length === 1, 'expected one peer')
    if (peers[0].peerId === 'bad') sawBad = true
    if (peers[0].peerId === 'good') sawGood = true
  }
  assert(sawBad && sawGood, 'non-WebRTC should pick among all peers, including disabled list')
})

test('filter disabled: WebRTC and no enabled filter returns disabled peers too', () => {
  const disabledMap = {}
  disabledMap[infoHash] = {
    peers: ['bad'],
    peersSet: new Set(['bad']),
    torrentId: 't-4'
  }
  const server = createMockServer(false, disabledMap)
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'good', 'ws')
  addPeer(swarm, 'bad', 'ws')

  let sawBad = false
  let sawGood = false
  for (let i = 0; i < 120; i++) {
    const peers = swarm._getPeers(1, 'requestor', true)
    assert(peers.length === 1, 'expected one peer')
    if (peers[0].peerId === 'bad') sawBad = true
    if (peers[0].peerId === 'good') sawGood = true
  }
  assert(sawBad && sawGood, 'disabled filter should be off when seed filter is disabled')
})

console.log('All disabled seeders filter tests complete')
