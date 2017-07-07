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

  if(this.autoStart){
    this.start();
  }
};

Worker.prototype.start = function(){
  this.updatePool();
};

Worker.prototype.report = function(){
  return this.poolers.map(function(poolers){
    return pooler.report()
  })
};

Worker.prototype.updatePool = function(){
  if(this._poolers.length < this.concurrency){
    this.addPooler();
    this.updatePool()
  } else if(this._poolers.length > this.concurrency) {
    this.removePooler();
    this.updatePool()
  }
};

Worker.prototype.addPooler = function(){
  this._poolers.push(new Poller({
    activityArn : this.activityArn,
    workerName : this.workerName,
    worker : this
  }))
};

Worker.prototype.removePooler = function(){
  var removedPooler = this._poolers.pop();
  removedPooler.stop();
};

Worker.prototype.execute = function(input, cb, heartbeat){
  if(typeof(this.fn) === "function"){
    this.fn.call(this, input, cb, heartbeat)
  } else {
    cb(new Error("worker does not define any function"));
  }
};

Worker.prototype.succeed = function(res){
  const params = Object.assign({},res,{output : JSON.stringify(res.output)})
  stepfunction.sendTaskSuccess(params, function(err, data){
    console.log("sent task success");
    if(err){
      this.emit("error", err);
    } else {
      this.emit("success", res);
    }
  }.bind(this))
};

Worker.prototype.fail = function(res){
  stepfunction.sendTaskFailure(res, function(err){
    if(err){
      this.emit("error", err);
    } else {
      this.emit("failure", res);
    }
  }.bind(this))
};

Worker.prototype.heartbeat = function(res){
  stepfunction.sendTaskHeartbeat(res, function(err){
    if(err){
      this.emit("error", err);
    } else {
      this.emit("heartbeat", res);
    }
  }.bind(this))
};

util.inherits(Worker, EventEmitter);

module.exports = Worker;
