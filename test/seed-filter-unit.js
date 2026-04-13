/**
 * Unit test for seed status filtering in _getPeers.
 * Run: node test/seed-filter-unit.js
 */
import Swarm from '../lib/server/swarm.js'

const infoHash = 'a'.repeat(40)

function createMockServer (seedFilterEnabled, seedStatusMap, progressMin = 35) {
  return {
    peersCacheLength: 100,
    peersCacheTtl: 60000,
    _seedFilterEnabled: seedFilterEnabled,
    _seedStatusMap: seedStatusMap,
    _seedProgressMin: progressMin
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

console.log('Seed filter unit tests')

test('no filter: returns all peers randomly', () => {
  const server = createMockServer(false, {})
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 10; i++) addPeer(swarm, `peer${i}`, 'ws')
  const peers = swarm._getPeers(5, 'requestor', true)
  assert(peers.length === 5, `expected 5 peers, got ${peers.length}`)
})

test('filter enabled but no statuses for this infoHash: returns all peers', () => {
  const server = createMockServer(true, {})
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 10; i++) addPeer(swarm, `peer${i}`, 'ws')
  const peers = swarm._getPeers(5, 'requestor', true)
  assert(peers.length === 5, `expected 5 peers, got ${peers.length}`)
})

test('filter: eligible peers returned first', () => {
  const statusMap = {}
  statusMap[infoHash] = {
    peer0: { paused: false, progress: 80 },
    peer1: { paused: false, progress: 90 },
    peer2: { paused: true, progress: 80 },
    peer3: { paused: false, progress: 10 },
    peer4: { paused: false, progress: 100 }
  }
  const server = createMockServer(true, statusMap)
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 5; i++) addPeer(swarm, `peer${i}`, 'ws')

  const peers = swarm._getPeers(3, 'requestor', true)
  assert(peers.length === 3, `expected 3 peers, got ${peers.length}`)

  const eligiblePeerIds = new Set(['peer0', 'peer1', 'peer4'])
  const returnedEligible = peers.filter(p => eligiblePeerIds.has(p.peerId)).length
  assert(returnedEligible === 3, `expected 3 eligible, got ${returnedEligible}`)
})

test('filter: fallback used when not enough eligible', () => {
  const statusMap = {}
  statusMap[infoHash] = {
    peer0: { paused: false, progress: 80 },
    peer1: { paused: true, progress: 80 },
    peer2: { paused: true, progress: 80 }
  }
  const server = createMockServer(true, statusMap)
  const swarm = new Swarm(infoHash, server)
  for (let i = 0; i < 3; i++) addPeer(swarm, `peer${i}`, 'ws')

  const peers = swarm._getPeers(3, 'requestor', true)
  assert(peers.length === 3, `expected 3 peers, got ${peers.length}`)
  assert(peers[0].peerId === 'peer0', 'first peer should be eligible')
})

test('filter: unknown peers go to fallback', () => {
  const statusMap = {}
  statusMap[infoHash] = {
    peer0: { paused: false, progress: 80 }
  }
  const server = createMockServer(true, statusMap)
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'peer0', 'ws')
  addPeer(swarm, 'unknown_peer', 'ws')

  const peers = swarm._getPeers(2, 'requestor', true)
  assert(peers.length === 2, `expected 2 peers, got ${peers.length}`)
  assert(peers[0].peerId === 'peer0', 'first peer should be eligible known peer')
})

test('filter: WebRTC always prefers eligible when numwant=1', () => {
  const statusMap = {}
  statusMap[infoHash] = {
    good: { paused: false, progress: 100 },
    bad: { paused: true, progress: 0 }
  }
  const server = createMockServer(true, statusMap)
  const swarm = new Swarm(infoHash, server)
  addPeer(swarm, 'good', 'ws')
  addPeer(swarm, 'bad', 'ws')
  for (let i = 0; i < 30; i++) {
    const peers = swarm._getPeers(1, 'requestor', true)
    assert(peers.length === 1 && peers[0].peerId === 'good', 'WebRTC should only return eligible peer')
  }
})

test('filter: HTTP/UDP announce path does not apply seed status filter', () => {
  const statusMap = {}
  statusMap[infoHash] = {
    good: { paused: false, progress: 100 },
    bad: { paused: true, progress: 0 }
  }
  const server = createMockServer(true, statusMap)
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
  assert(sawBad && sawGood, 'non-WebRTC should pick among all peers, not only cloud-eligible')
})

console.log('All seed filter tests complete')
