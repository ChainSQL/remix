# Remix

[![Join the chat at https://gitter.im/ethereum/remix](https://badges.gitter.im/ethereum/remix.svg)](https://gitter.im/ethereum/remix?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![CircleCI](https://circleci.com/gh/ethereum/remix/tree/master.svg?style=svg)](https://circleci.com/gh/ethereum/remix/tree/master)
[![Documentation Status](https://readthedocs.org/projects/docs/badge/?version=latest)](https://remix.readthedocs.io/en/latest/)

**This Remix is forked from [Ethereum Remix](https://github.com/ethereum/remix)**

ChainSQL tools for the web.

*Are you looking for the ChainSQL Remix IDE? Follow [this link](https://github.com/ChainSQL/remix-ide)!*

+ [What is Remix?](#what-is-remix)
+ [How to use Remix?](#how-to-use)
+ [Modules](#modules)
+ [Contributing guidelines](#contributing)

## <a name="what-is-remix"></a>What is Remix?

**Remix** is a suite of tools to interact with the ChainSQL blockchain in order to debug transactions, stored in this Git repository. A Remix transaction Web debugger is available [here](http://remix.chainsql.net), and its source code is part of this repository.

The **Remix IDE** is an IDE for Solidity dApp developers, powered by Remix. The Remix IDE repository **is available [here](https://github.com/ChainSQL/remix-ide)**, and an online version is available at https://remix.chainsql.net.

For more, check out the [Remix documentation on ReadTheDocs](https://remix.readthedocs.io/en/latest/).

## <a name="how-to-use"></a>How to use Remix

### Prerequisites

To use Remix tools, you'll need to connect to an ChainSQL node. 

### Run the debugger

See [here](remix-debugger/README.md) how to install, run and use the debugger locally.

The debugger itself contains several controls that allow stepping over the trace and seeing the current state of a selected step.

## <a name="modules"></a>Remix Modules

Remix is built out of several different modules:

+ [`remix-analyzer`](remix-analyzer/README.md)
+ [`remix-solidity`](remix-solidity/README.md) provides Solidity analysis and decoding functions.
+ [`remix-lib`](remix-lib/README.md)
+ [`remix-debug`](remix-debugger/README.md) is now *deprecated*. It contains the debugger.
+ [`remix-tests`](remix-tests/README.md) contains our tests.
+ [`remixd`](https://github.com/ethereum/remixd/tree/master) CLI which allow accessing local element from Remix IDE (see https://remix.readthedocs.io/en/latest/tutorial_remixd_filesystem.html)

Each generally has their own npm package and test suite, as well as basic documentation.

## Contributing

Everyone is very welcome to contribute on the codebase of Remix. Please reach us in [Gitter](https://gitter.im/ethereum/remix).

For more information on the contributing procedure, see [CONTRIBUTING.md](CONTRIBUTING.md). For more information on running and developing the Remix debugger, see [the debugger README.md](remix-debugging/README.md).
