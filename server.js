var http = require('http')
var ecstatic = require('ecstatic')
var WebSocketServer = require('ws').Server
var websocket = require('websocket-stream')
var duplexEmitter = require('duplex-emitter')
var MuxDemux = require('mux-demux')
var Model = require('scuttlebutt/model')
var playerPhysics = require('player-physics')
var path = require('path')
var uuid = require('hat')
// var engine = require('voxel-engine')
var createGame = require('voxel-engine')
var voxel = require('voxel')
// var simplex = require('voxel-simplex-terrain')

//var chunkSize = 32
//var chunkDistance = 1
//var scaleFactor = 10
//var seed = process.argv[2] || uuid()
var fakeLag = 100

var texturePath = require('painterly-textures')(__dirname)

// function getMaterialIndex(seed, simplex, width, x, y, z) {
//   if (x*x + y*y + z*z > 30*30) return 0
//   return 1
// }

//var generator = simplex({seed: seed, scaleFactor: scaleFactor, chunkDistance: chunkDistance, getMaterialIndex: getMaterialIndex})
// var settings = {
//   generate: voxel.generator['Valley'],
//   //generateVoxelChunk: generator,
//   texturePath: './textures/',
//   //texturePath: texturePath,
//   //materials: [['grass', 'dirt', 'grass_dirt'], 'brick', 'dirt', 'obsidian', 'snow'],
//   //cubeSize: 25,
//   //chunkSize: chunkSize,
//   //chunkDistance: chunkDistance,
//   //startingPosition: {x: 0, y: 1000, z: 0},
//   startingPosition: [185, 100, 0],
//   // worldOrigin: {x: 0, y: 0, z: 0},
//   //worldOrigin: [185, 100, 0],
//   worldOrigin: [0,0,0],
//   //scaleFactor: scaleFactor,
//   controlOptions: {jump: 6},
//   controlsDisabled: true,
//   generateChunks: false
// }
// var game = engine(settings)
var settings = {
  generate: voxel.generator['Valley'],
  startingPosition: [185, 100, 0],
  texturePath: './textures/',
  controlsDisabled: true,
  generateChunks: false
}
var game = createGame(settings)

var server = http.createServer(ecstatic(path.join(__dirname, 'www')))
var wss = new WebSocketServer({server: server})
var voxelStore = new Model()
var clients = {}

function broadcast(id, cmd, arg1, arg2, arg3) {
  Object.keys(clients).map(function(client) {
    if (client === id) return
    clients[client].emit(cmd, arg1, arg2, arg3)
  })
}

// setInterval(function() {
//   var clientKeys = Object.keys(clients)
//   if (clientKeys.length === 0) return
//   var update = {positions:{}}
//   clientKeys.map(function(key) {
//     var emitter = clients[key]
//     update.positions[key] = {
//       position: emitter.player.yawObject.position,
//       velocity: emitter.player.velocity,
//       rotation: {
//         x: emitter.player.pitchObject.rotation.x,
//         y: emitter.player.yawObject.rotation.y
//       },
//       seq: emitter.player.lastProcessedSeq
//     }
//   })
//   broadcast(false, 'update', update)
// }, 1000/22)

// Careful! This can hork the whole thing.
// setInterval(function() {
//   var clientKeys = Object.keys(clients)
//   if (clientKeys.length === 0) return
//   clientKeys.map(function(key) {
//     var emitter = clients[key]
//     var delta = Date.now() - emitter.lastUpdate
// 	//console.log("delta: " + delta + " emitter.player.yawObject.position: " + JSON.stringify(emitter.player.yawObject.position))
//     // emitter.player.tick(delta, function(controls) {
//     //       var bbox = game.playerAABB(emitter.player.yawObject.position)
//     //       game.updatePlayerPhysics(bbox, emitter.player)
//     //     })
//     emitter.lastUpdate = Date.now()
//   })
// }, 1000/66)
// // 1000/66)

wss.on('connection', function(ws) {
  console.log("Connected!")
  var stream = websocket(ws)
  var mdm = MuxDemux()
  stream.pipe(mdm).pipe(stream)
  var emitterStream = mdm.createStream('emitter')
  var emitter = duplexEmitter(emitterStream)

  var voxelStream = mdm.createStream('voxels')
  var storeStream = voxelStore.createStream()
  storeStream.pipe(voxelStream).pipe(storeStream)
  
  var id = uuid()
  clients[id] = emitter
  emitter.lastUpdate = Date.now()
  
  emitter.scene = new game.THREE.Scene()
    var playerOptions = {
      pitchObject: new game.THREE.Object3D(),
      yawObject: new game.THREE.Object3D(),
      velocityObject: new game.THREE.Vector3()
    }
    emitter.player = playerPhysics(false, playerOptions)
    emitter.player.enabled = true
    emitter.player.yawObject.position.copy(settings.startingPosition)
    emitter.player.lastProcessedSeq = 0
    emitter.scene.add( emitter.player.yawObject )

  console.log(id, 'joined')
  emitter.emit('id', id)
  broadcast(id, 'join', id)
  stream.once('end', leave)
  stream.once('error', leave)
  function leave() {
    delete clients[id]
    console.log(id, 'left')
    broadcast(id, 'leave', id)
  }
  emitter.on('generated', function(seq) {
	console.log("generated")
    emitter.on('jump', function() {
      setTimeout(function() {
        emitter.player.emit('command', 'jump')        
      }, fakeLag)
    })
    emitter.on('state', function(state) {
      setTimeout(function() {
        Object.keys(state.movement).map(function(key) {
          emitter.player[key] = state.movement[key]
        })
		console.log("set emitter.player")
        emitter.player.yawObject.rotation.y = state.rotation.y
        emitter.player.pitchObject.rotation.x = state.rotation.x
        emitter.scene.updateMatrixWorld()
        emitter.player.lastProcessedSeq = state.seq
      }, fakeLag)
    })
  })
  emitter.on('ping', function(data) {
    emitter.emit('pong', data)
  })
  emitter.emit('settings', settings)
  emitter.on('set', function(ckey, pos, val) {
	console.log("set voxelAtChunkIndexAndVoxelVector")
    var before = voxelAtChunkIndexAndVoxelVector(ckey, pos)
    var after = voxelAtChunkIndexAndVoxelVector(ckey, pos, val)
    var key = ckey + '|' + pos.x + '|' + pos.y + '|' + pos.z
    voxelStore.set(key, val)
  })
})

function voxelAtChunkIndexAndVoxelVector(ckey, v, val) {
  var chunk = game.voxels.chunks[ckey]
  if (!chunk) return false
  var size = game.voxels.chunkSize
  var vidx = v.x + v.y*size + v.z*size*size
  if (typeof val !== 'undefined') {
    chunk.voxels[vidx] = val
  }
  var v = chunk.voxels[vidx]
  return v
}

var port = process.argv[2] || 8080
server.listen(port)
console.log('Listening on ', port, ' open http://localhost:', port)

process.on('uncaughtException', function(err) {
  console.error(err);
  //process.exit();
});
