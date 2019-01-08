'use strict'

function disableDebugLog(){
    return;
}
var enableDebugLog = console.log

const env = {
    devEnv : enableDebugLog,
    productEnv : disableDebugLog
}
module.exports = env.productEnv