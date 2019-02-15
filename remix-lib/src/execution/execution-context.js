'use strict'
var Web3 = require('web3')
var EventManager = require('../eventManager')
var EthJSVM = require('ethereumjs-vm')
var ethUtil = require('ethereumjs-util')
var StateManager = require('ethereumjs-vm/dist/stateManager')
var Web3VMProvider = require('../web3Provider/web3VmProvider')
const debLog = require('../debuglogger')
const ChainsqlAPI = require('chainsql').ChainsqlAPI;
//const chainsql = new ChainsqlAPI();

var chainsql

var rlp = ethUtil.rlp

var injectedProvider

var web3
if (typeof window !== 'undefined' && typeof window.web3 !== 'undefined') {
  injectedProvider = window.web3.currentProvider
  web3 = new Web3(injectedProvider)
} else {
  web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
}

var blankWeb3 = new Web3()

/*
  extend vm state manager and instanciate VM
*/

class StateManagerCommonStorageDump extends StateManager {
  constructor (arg) {
    super(arg)
    this.keyHashes = {}
  }

  putContractStorage (address, key, value, cb) {
    this.keyHashes[ethUtil.sha3(key).toString('hex')] = ethUtil.bufferToHex(key)
    super.putContractStorage(address, key, value, cb)
  }

  dumpStorage (address, cb) {
    var self = this
    this._getStorageTrie(address, function (err, trie) {
      if (err) {
        return cb(err)
      }
      var storage = {}
      var stream = trie.createReadStream()
      stream.on('data', function (val) {
        var value = rlp.decode(val.value)
        storage['0x' + val.key.toString('hex')] = {
          key: self.keyHashes[val.key.toString('hex')],
          value: '0x' + value.toString('hex')
        }
      })
      stream.on('end', function () {
        cb(storage)
      })
    })
  }
}

var stateManager = new StateManagerCommonStorageDump({})
var vm = new EthJSVM({
  enableHomestead: true,
  activatePrecompiles: true
})

// FIXME: move state manager in EthJSVM ctr
vm.stateManager = stateManager
vm.blockchain = stateManager.blockchain
vm.trie = stateManager.trie
vm.stateManager.checkpoint()

var web3VM = new Web3VMProvider()
web3VM.setVM(vm)

var mainNetGenesisHash = '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3'

/*
  trigger contextChanged, web3EndpointChanged
*/
function ExecutionContext () {
  var self = this
  this.event = new EventManager()
  this.chainsqlObjs = {}

  var executionContext = null
  this.contractObjs = {}

  this.blockGasLimitDefault = 4300000
  this.blockGasLimit = this.blockGasLimitDefault
  this.customNetWorks = {}

  this.init = function (config) {
    executionContext = 'chainsql'
    // if (config.get('settings/always-use-vm')) {
    //   executionContext = 'vm'
    // } else {
    //   executionContext = injectedProvider ? 'injected' : 'vm'
    // }
  }

  this.getProvider = function () {
    return executionContext
  }

  this.isVM = function () {
    return executionContext === 'vm'
  }

  this.web3 = function () {
    return this.isVM() ? web3VM : web3
  }

  this.chainsql = function () {
    return this.isVM() ? web3VM : chainsql
  }

  this.initContractObj = function (isload, contractName, contractAbi, contractAddr) {
    debLog('initContractObj contractName:' + contractName)
    let contractId = this.currentChainsqlWS + contractName
    if(!this.contractObjs.hasOwnProperty(contractId)) {
      let contractObj
      if(isload) {
        contractObj = chainsql.contract(contractAbi, contractAddr)
        contractId += contractAddr
        this.contractObjs[contractId] = contractObj
        self.event.trigger('loadContract', [contractAddr, contractName])
      }
      else {
        contractObj = chainsql.contract(contractAbi)
        this.contractObjs[contractId] = contractObj
      }
    }
  }

  this.removeContractObj = function (contractName) {
    delete this.contractObjs[contractName]
  }

  this.detectNetwork = function (callback) {
    if (this.isVM()) {
      callback(null, { id: '-', name: 'VM' })
    } else {
      //maybe other unique info for connected node.
      let id = 1;
      let name = 'ChainSQL';
      callback(null, {id, name});
    }
  }

  this.removeProvider = function (name) {
    if (name && this.customNetWorks[name]) {
      delete this.customNetWorks[name]
      self.event.trigger('removeProvider', [name])
    }
  }

  this.addProvider = function (network) {
    if (network && network.name && network.url) {
      this.customNetWorks[network.name] = network
      self.event.trigger('addProvider', [network])
    }
  }

  this.internalWeb3 = function () {
    return web3
  }

  this.blankWeb3 = function () {
    return blankWeb3
  }

  this.vm = function () {
    return vm
  }

  this.setContext = function (context, endPointUrl, confirmCb, infoCb) {
    executionContext = context
    this.executionContextChange(context, endPointUrl, confirmCb, infoCb)
  }

  this.executionContextChange = function (context, endPointUrl, confirmCb, infoCb, cb) {
    debLog('[In executionContextChange]')
    if (!cb) cb = () => {}

    if (context === 'vm') {
      executionContext = context
      vm.stateManager.revert(function () {
        vm.stateManager.checkpoint()
      })
      self.event.trigger('contextChanged', ['vm'])
      return cb()
    }

    if (context === 'injected') {
      if (injectedProvider === undefined) {
        var alertMsg = 'No injected Web3 provider found. '
        alertMsg += 'Make sure your provider (e.g. MetaMask) is active and running '
        alertMsg += '(when recently activated you may have to reload the page).'
        infoCb(alertMsg)
        return cb()
      } else {
        executionContext = context
        web3.setProvider(injectedProvider)
        self._updateBlockGasLimit()
        self.event.trigger('contextChanged', ['injected'])
        return cb()
      }
    }

    if (context === 'chainsql') {
      executionContext = context;
      self.currentChainsqlWS = endPointUrl
      chainsql = self.chainsqlObjs[endPointUrl]
      debLog("selected chainsql, endpoint:", endPointUrl)
      self.event.trigger('contextChanged', ['chainsql'])
      // confirmCb(cb)
      return cb()
    }

    // if (this.customNetWorks[context]) {
    //   var provider = this.customNetWorks[context]
    //   setProviderFromEndpoint(provider.url, provider.name, () => { cb() })
    // }
  }

  this.currentblockGasLimit = function () {
    return this.blockGasLimit
  }

  this.stopListenOnLastBlock = function () {
    if (this.listenOnLastBlockId) clearInterval(this.listenOnLastBlockId)
    this.listenOnLastBlockId = null
  }

  this._updateBlockGasLimit = function () {
    if (this.getProvider() !== 'vm') {
      web3.eth.getBlock('latest', (err, block) => {
        if (!err) {
          // we can't use the blockGasLimit cause the next blocks could have a lower limit : https://github.com/ethereum/remix/issues/506
          this.blockGasLimit = (block && block.gasLimit) ? Math.floor(block.gasLimit - (5 * block.gasLimit) / 1024) : this.blockGasLimitDefault
        } else {
          this.blockGasLimit = this.blockGasLimitDefault
        }
      })
    }
  }

  this.listenOnLastBlock = function () {
    this.listenOnLastBlockId = setInterval(() => {
      //this._updateBlockGasLimit()
    }, 15000)
  }

  // TODO: not used here anymore and needs to be moved
  function setProviderFromEndpoint (endpoint, context, cb) {
    //let oldChainsqlWS = self.currentChainsqlWS;

    const chainsqlTemp = new ChainsqlAPI();
    chainsqlTemp.connect(endpoint).then((data) => {
      executionContext = context;
      self.currentChainsqlWS = endpoint;
      
      chainsqlTemp.toDrop = function toDrop(number, unit){
        if (number === "") {
          return 0
        }
        if (unit === 'zxc') {
          let numInDrop = number*(10**6)
          return numInDrop.toString()
        } else if(unit === 'drop') {
          return number
        }
      }

      chainsql = chainsqlTemp
      this.chainsqlObjs[endpoint] = chainsqlTemp
      self.event.trigger('contextChanged', ['chainsql']);
      self.event.trigger('chainsqlWSChanged');
      let conSucInfo = 'Connet to ChainSQL node successfully, node:[ ' + endpoint + ' ]'
      cb(true,conSucInfo);
    }).catch((err) => {
      //chainsql.connect(oldChainsqlWS);
      let alertMsg = 'Cannot connect to [ ' + endpoint + ' ], Please check the ws address.';
      alertMsg += err;
      cb(false,alertMsg);
    });
    // chainsql.disconnect().then((data) => {
    //   //disconnect successful
    //   chainsql.connect(endpoint).then((data) => {
    //     executionContext = context;
    //     self.currentChainsqlWS = endpoint;
    //     self.event.trigger('contextChanged', ['chainsql']);
    //     self.event.trigger('chainsqlWSChanged');
    //     cb("connet to chainsql node successfully");
    //   }).catch((err) => {
    //     chainsql.connect(oldChainsqlWS);
    //     let alertMsg = "Cannot connect to the chainsql websocket. Please check the ws address. ";
    //     alertMsg += err;
    //     cb(alertMsg);
    //   });
    // }).catch((err) => {
    //   let alertMsg = "disconnect from current chainsqlnode failed" + err;
    //   cb(alertMsg);
    // })
    
    // var oldProvider = web3.currentProvider

    // if (endpoint === 'ipc') {
    //   web3.setProvider(new web3.providers.IpcProvider())
    // } else {
    //   web3.setProvider(new web3.providers.HttpProvider(endpoint))
    // }
    // if (web3.isConnected()) {
    //   executionContext = context
    //   self._updateBlockGasLimit()
    //   self.event.trigger('contextChanged', ['web3'])
    //   self.event.trigger('web3EndpointChanged')
    //   cb()
    // } else {
    //   web3.setProvider(oldProvider)
    //   var alertMsg = 'Not possible to connect to the Web3 provider. '
    //   alertMsg += 'Make sure the provider is running and a connection is open (via IPC or RPC).'
    //   cb(alertMsg)
    // }
  }
  this.setProviderFromEndpoint = setProviderFromEndpoint

  this.txDetailsLink = function (network, hash) {
    if (transactionDetailsLinks[network]) {
      return transactionDetailsLinks[network] + hash
    }
  }
}

var transactionDetailsLinks = {
  'Main': 'https://www.etherscan.io/tx/',
  'Rinkeby': 'https://rinkeby.etherscan.io/tx/',
  'Ropsten': 'https://ropsten.etherscan.io/tx/',
  'Kovan': 'https://kovan.etherscan.io/tx/'
}

module.exports = new ExecutionContext()
