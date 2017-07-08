const EventEmitter = require('events').EventEmitter;
const util = require('util');
const AWS = require('aws-sdk');
const stepfunction = new AWS.StepFunctions();
const Poller = require("./pooler.js")

/**
* @class Worker
* @param {object} options
* @param {string} options.activityArn
* @param {string} [options.workerName=null]
* @param {function} [options.fn=null]
* @param {boolean} [options.autoStart=true]
* @param {string} [options.concurrency=1]
**/

function Worker(options) {
  EventEmitter.call(this);
  this.autoStart = typeof(options.autoStart) !== "boolean" ? true : options.autoStart;

  if(!options.activityArn){
    this.emit("error", new Error("activityArn is mandatory inside Worker"));
    return
  }

  this.concurrency = typeof(options.concurrency) !== "number" ? 1 : options.concurrency;

  this.activityArn = options.activityArn;
  this.workerName = options.workerName;

  this.fn = options.fn;
  this._poolers = [];

  if(typeof(this.fn) !== "function"){
    throw(new Error("worker does not define any function"));
  }

  if(this.autoStart){
    this.start(function(){
      //do nothing
    });
  }
};

Worker.prototype.start = function(cb){
  this.updatePool(cb);
};

Worker.prototype.report = function(){
  return this.poolers.map(function(poolers){
    return pooler.report()
  })
};

Worker.prototype.updatePool = function(cb){
  if(this._poolers.length < this.concurrency){
    this.addPooler(this._poolers.length);
    this.updatePool(cb)
  } else if(this._poolers.length > this.concurrency) {
    this.removePooler(function(){
      this.updatePool(cb)
    }.bind(this));
  } else {
    cb && cb()
  }
};

Worker.prototype.addPooler = function(index){
  var pooler = new Poller({
    activityArn : this.activityArn,
    workerName : this.workerName,
    worker : this,
    index : index
  });

  pooler.on("error", function(err){
    this.emit("error", err)
  }.bind(this));

  this._poolers.push(pooler)
};

Worker.prototype.removePooler = function(cb){
  var removedPooler = this._poolers.pop();
  removedPooler.stop(cb);
};

Worker.prototype.close = function(cb){
  this.concurrency = 0;
  this.updatePool(cb);
  this.removeAllListeners();
};


Worker.prototype.execute = function(input, cb, heartbeat){
  if(typeof(this.fn) === "function"){
    this.fn.call(this, input, cb, heartbeat);
  } else {
    cb(new Error("worker does not define any function"));
  }
};

Worker.prototype.succeed = function(res){
  const params = Object.assign({},res,{output : JSON.stringify(res.output)})
  delete params.workerName;
  stepfunction.sendTaskSuccess(params, function(err, data){
    if(err){
      this.emit("error", err);
    } else {
      this.emit("success", res);
    }
  }.bind(this))
};

Worker.prototype.fail = function(res){
  const params = Object.assign({},res,{error : JSON.stringify(res.error)})
  delete params.workerName;

  stepfunction.sendTaskFailure(params, function(err){
    if(err){
      this.emit("error", err);
    } else {
      this.emit("failure", res);
    }
  }.bind(this))
};

Worker.prototype.heartbeat = function(res){
  const params = Object.assign({},res);
  delete params.workerName;

  stepfunction.sendTaskHeartbeat(params, function(err){
    if(err){
      this.emit("error", err);
    } else {
      this.emit("heartbeat", res);
    }
  }.bind(this))
};

util.inherits(Worker, EventEmitter);

module.exports = Worker;
