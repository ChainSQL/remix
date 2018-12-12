'use strict'
var async = require('async')
var ethers = require('ethers')
var ethJSUtil = require('ethereumjs-util')
var EventManager = require('../eventManager')
var codeUtil = require('../util')

var executionContext = require('./execution-context')
var txFormat = require('./txFormat')
var txHelper = require('./txHelper')

/**
  * poll web3 each 2s if web3
  * listen on transaction executed event if VM
  * attention: blocks returned by the event `newBlock` have slightly different json properties whether web3 or the VM is used
  * trigger 'newBlock'
  *
  */
class TxListener {
  constructor (opt) {
    this.event = new EventManager()
    this._api = opt.api
    this._resolvedTransactions = {}
    this._resolvedContracts = {}
    this._isListening = false
    this._listenOnNetwork = false
    this._loopId = null
    this.init()
    executionContext.event.register('contextChanged', (context) => {
      if (this._isListening) {
        this.stopListening()
        this.startListening()
      }
    })

    opt.event.udapp.register('callExecuted', (error, from, to, data, lookupOnly, txResult) => {
      if (error) return
      // we go for that case if
      // in VM mode
      // in web3 mode && listen remix txs only
      if (!this._isListening) return // we don't listen
      if (this._loopId && executionContext.getProvider() !== 'vm') return // we seems to already listen on a "web3" network

      var call = {
        from: from,
        to: to,
        input: data,
        id: txResult.transactionHash ? txResult.transactionHash : 'call' + (from || '') + to + data,
        isCall: true,
        returnValue: executionContext.isVM() ? txResult.result.vm.return : ethJSUtil.toBuffer(parseInt(txResult)),
        envMode: executionContext.getProvider(),
        specification: { ContractOpType: 3,
                         ContractAddress: to,
                         ContractData: data.replace('0x', '')},
        outcome: {}
      }

      //addExecutionCosts(txResult, call)
      this._resolveTx(call, (error, resolvedData) => {
        if (!error) {
          console.log("trigger newCall")
          this.event.trigger('newCall', [call])
        }
      })
    })

    opt.event.udapp.register('transactionExecuted', (error, from, to, data, lookupOnly, txResult) => {
      if (error) return
      if (lookupOnly) return
      // we go for that case if
      // in VM mode
      // in web3 mode && listen remix txs only
      if (!this._isListening) return // we don't listen
      if (this._loopId && executionContext.getProvider() !== 'vm') return // we seems to already listen on a "web3" network
      // executionContext.web3().eth.getTransaction(txResult.transactionHash, (error, tx) => {
      console.log("In transactionExecuted fun, txResult:", txResult);
      executionContext.chainsql().api.getTransaction(txResult.tx_hash).then(txDetail => {
        // if (error) return console.log(error)

        // addExecutionCosts(txResult, tx)
        txDetail.envMode = executionContext.getProvider()
        if(txResult.status.indexOf("success") !== -1){
          txDetail.status = true;
        } else {
          txDetail.status = false;
        }
        //tx.status = txResult.result.status // 0x0 or 0x1
        if(txDetail.specification.ContractOpType === 1){
          console.log("contractAddress", txResult.contractAddress)
          txDetail.contractAddress = txResult.contractAddress
        }
        txDetail.isCall = false
        // this._resolve([tx], () => {
        this._resolve([txDetail], () => {
        })
      }).catch(error => {
        if (error) return console.log(error)
      })
    })

    function addExecutionCosts (txResult, tx) {
      if (txResult && txResult.result) {
        if (txResult.result.vm) {
          tx.returnValue = txResult.result.vm.return
          if (txResult.result.vm.gasUsed) tx.executionCost = txResult.result.vm.gasUsed.toString(10)
        }
        if (txResult.result.gasUsed) tx.transactionCost = txResult.result.gasUsed.toString(10)
      }
    }
  }

  /**
    * define if txlistener should listen on the network or if only tx created from remix are managed
    *
    * @param {Bool} type - true if listen on the network
    */
  setListenOnNetwork (listenOnNetwork) {
    this._listenOnNetwork = listenOnNetwork
    if (this._loopId) {
      clearInterval(this._loopId)
    }
    if (this._listenOnNetwork) {
      this._startListenOnNetwork()
    }
  }

  /**
    * reset recorded transactions
    */
  init () {
    this.blocks = []
    this.lastBlock = null
  }

  /**
    * start listening for incoming transactions
    *
    * @param {String} type - type/name of the provider to add
    * @param {Object} obj  - provider
    */
  startListening () {
    this.init()
    this._isListening = true
    if (this._listenOnNetwork && executionContext.getProvider() !== 'vm') {
      this._startListenOnNetwork()
    }
  }

   /**
    * stop listening for incoming transactions. do not reset the recorded pool.
    *
    * @param {String} type - type/name of the provider to add
    * @param {Object} obj  - provider
    */
  stopListening () {
    if (this._loopId) {
      clearInterval(this._loopId)
    }
    this._loopId = null
    this._isListening = false
  }

  _startListenOnNetwork () {
    this._loopId = setInterval(() => {
      var currentLoopId = this._loopId
      executionContext.web3().eth.getBlockNumber((error, blockNumber) => {
        if (this._loopId === null) return
        if (error) return console.log(error)
        if (currentLoopId === this._loopId && (!this.lastBlock || blockNumber > this.lastBlock)) {
          if (!this.lastBlock) this.lastBlock = blockNumber - 1
          var current = this.lastBlock + 1
          this.lastBlock = blockNumber
          while (blockNumber >= current) {
            try {
              this._manageBlock(current)
            } catch (e) {
              console.log(e)
            }
            current++
          }
        }
      })
    }, 2000)
  }

  _manageBlock (blockNumber) {
    executionContext.web3().eth.getBlock(blockNumber, true, (error, result) => {
      if (!error) {
        this._newBlock(Object.assign({type: 'web3'}, result))
      }
    })
  }

  /**
    * try to resolve the contract name from the given @arg address
    *
    * @param {String} address - contract address to resolve
    * @return {String} - contract name
    */
  resolvedContract (address) {
    return this._resolvedContracts[address]
  }

  /**
    * try to resolve the transaction from the given @arg txHash
    *
    * @param {String} txHash - contract address to resolve
    * @return {String} - contract name
    */
  resolvedTransaction (txHash) {
    return this._resolvedTransactions[txHash]
  }

  _newBlock (block) {
    this.blocks.push(block)
    this._resolve(block.transactions, () => {
      this.event.trigger('newBlock', [block])
    })
  }

  // _resolve (transactions, callback) {
  //   async.each(transactions, (tx, cb) => {
  //     this._api.resolveReceipt(tx, (error, receipt) => {
  //       if (error) return cb(error)
  //       this._resolveTx(tx, receipt, (error, resolvedData) => {
  //         if (error) cb(error)
  //         if (resolvedData) {
  //           this.event.trigger('txResolved', [tx, receipt, resolvedData])
  //         }
  //         this.event.trigger('newTransaction', [tx, receipt])
  //         cb()
  //       })
  //     })
  //   }, () => {
  //     callback()
  //   })
  // }
  _resolve (transactions, callback) {
    async.each(transactions, (tx, cb) => {
      this._resolveTx(tx, (error, resolvedData) => {
        let receipt = {}
        if (error) cb(error)
        console.log(resolvedData)
        if (resolvedData) {
          console.log("resolvedData is true")
          this.event.trigger('txResolved', [tx, receipt, resolvedData])
        }
        console.log("resolvedData is false")
        this.event.trigger('newTransaction', [tx, receipt])
        cb()
      })
    }, () => {
      callback()
    })
  }

  _resolveTx (tx, cb) {
    var contracts = this._api.contracts()
    if (!contracts) return cb()
    var contractName
    var fun
    // if (!tx.to || tx.to === '0x0') { // testrpc returns 0x0 in that case
    if(!tx.specification.ContractOpType){
      console.log("£¡number is ture?")
    }
    if (!tx.specification.ContractOpType || tx.specification.ContractOpType === 1) { // testrpc returns 0x0 in that case
      // contract creation / resolve using the creation bytes code
      // if web3: we have to call getTransactionReceipt to get the created address
      // if VM: created address already included
      // var code = tx.input
      var code = tx.specification.ContractData
      console.log("code:", code)
      console.log("contracts:", contracts)
      contractName = this._tryResolveContract(code, contracts, true)
      console.log("contractName:", contractName)
      if (contractName) {
        var address = tx.contractAddress
        this._resolvedContracts[address] = contractName
        fun = this._resolveFunction(contractName, contracts, tx, true)
        if (this._resolvedTransactions[tx.id]) {
          this._resolvedTransactions[tx.id].contractAddress = address
        }
        console.log("contractAddr:", address)
        return cb(null, {to: null, contractName: contractName, function: fun, creationAddress: address})
      }
      return cb()
    } else {
      // first check known contract, resolve against the `runtimeBytecode` if not known
      contractName = this._resolvedContracts[tx.specification.ContractAddress]
      if (!contractName) {
        // find code from chainsql node and compare to get the contract name
        // but chainsql don't have the getCode function

        // executionContext.web3().eth.getCode(tx.to, (error, code) => {
        //   if (error) return cb(error)
        //   if (code) {
        //     var contractName = this._tryResolveContract(code, contracts, false)
        //     if (contractName) {
        //       this._resolvedContracts[tx.specification.ContractAddress] = contractName
        //       var fun = this._resolveFunction(contractName, contracts, tx, false)
        //       return cb(null, {to: tx.specification.ContractAddress, contractName: contractName, function: fun})
        //     }
        //   }
        //   return cb()
        // })
        return
      }
      if (contractName) {
        console.log("Can find contractName, begin _resolveFunction")
        fun = this._resolveFunction(contractName, contracts, tx, false)
        return cb(null, {to: tx.specification.ContractAddress, contractName: contractName, function: fun})
      }
      return cb()
    }
  }

  _resolveFunction (contractName, compiledContracts, tx, isCtor) {
    var contract = txHelper.getContract(contractName, compiledContracts)
    if (!contract) {
      console.log('txListener: cannot resolve ' + contractName)
      return
    }
    var abi = contract.object.abi
    // var inputData = tx.input.replace('0x', '')
    var inputData = tx.specification.ContractData
    console.log(inputData.substring(0, 8).toLowerCase())
    if (!isCtor) {
      var methodIdentifiers = contract.object.evm.methodIdentifiers
      for (var fn in methodIdentifiers) {
        console.log(methodIdentifiers[fn].toLowerCase())
        if (methodIdentifiers[fn].toLowerCase() === inputData.substring(0, 8).toLowerCase()) {
          var fnabi = txHelper.getFunction(abi, fn)
          this._resolvedTransactions[tx.id] = {
            contractName: contractName,
            to: tx.specification.ContractAddress,
            fn: fn,
            params: this._decodeInputParams(inputData.substring(8), fnabi)
          }
          if (tx.returnValue) {
            console.log(tx.returnValue)
            this._resolvedTransactions[tx.id].decodedReturnValue = txFormat.decodeResponse(tx.returnValue, fnabi)
          }
          return this._resolvedTransactions[tx.id]
        }
      }
      // fallback function
      this._resolvedTransactions[tx.id] = {
        contractName: contractName,
        to: tx.specification.ContractAddress,
        fn: '(fallback)',
        params: null
      }
    } else {
      var bytecode = contract.object.evm.bytecode.object
      var params = null
      if (bytecode && bytecode.length) {
        params = this._decodeInputParams(inputData.substring(bytecode.length), txHelper.getConstructorInterface(abi))
      }
      this._resolvedTransactions[tx.id] = {
        contractName: contractName,
        to: null,
        fn: '(constructor)',
        params: params
      }
    }
    return this._resolvedTransactions[tx.id]
  }

  _tryResolveContract (codeToResolve, compiledContracts, isCreation) {
    var found = null
    txHelper.visitContracts(compiledContracts, (contract) => {
      var bytes = isCreation ? contract.object.evm.bytecode.object : contract.object.evm.deployedBytecode.object
      // if (codeUtil.compareByteCode(codeToResolve, '0x' + bytes)) {
      console.log(bytes)
      if (codeUtil.compareByteCode(codeToResolve.toLowerCase(), bytes)) {
        console.log(contract.name)
        found = contract.name
        return true
      }
    })
    return found
  }

  _decodeInputParams (data, abi) {
    data = ethJSUtil.toBuffer('0x' + data)
    if (!data.length) data = new Uint8Array(32 * abi.inputs.length) // ensuring the data is at least filled by 0 cause `AbiCoder` throws if there's not engouh data

    var inputTypes = []
    for (var i = 0; i < abi.inputs.length; i++) {
      var type = abi.inputs[i].type
      inputTypes.push(type.indexOf('tuple') === 0 ? txHelper.makeFullTupleTypeDefinition(abi.inputs[i]) : type)
    }
    var abiCoder = new ethers.utils.AbiCoder()
    var decoded = abiCoder.decode(inputTypes, data)
    var ret = {}
    for (var k in abi.inputs) {
      ret[abi.inputs[k].type + ' ' + abi.inputs[k].name] = decoded[k]
    }
    return ret
  }
}

module.exports = TxListener
