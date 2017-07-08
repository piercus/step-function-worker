const EventEmitter = require('events').EventEmitter;
const util = require('util');

/**
* @class StepFunctionWorker
* @param {object} options
* @param {object} options.worker
* @param {string} options.taskToken
* @param {string} options.workerName - this.pooler workerName
* @param {object} options.input
**/

function Task(options) {
  EventEmitter.call(this);

  this.worker = options.worker;
  this.input = options.input;
  this.taskToken = options.taskToken;
  this.workerName = options.workerName;
  this.startTime = new Date();
  this.worker.execute(this.input, this.taskCallback.bind(this), this.heartbeat.bind(this));
};

Task.prototype.taskCallback = function(err, res){
  if(err){
    this.fail(err);
  } else {
    this.succeed(res)
  }
};

Task.prototype.report = function(res){
  return {
    taskToken: this.taskToken,
    input : this.input,
    startTime : this.startTime
  }
};

Task.prototype.succeed = function(res){
  this.worker.succeed({
    output : res,
    taskToken : this.taskToken,
    workerName : this.workerName
  })
  this.emit("finish")
};

Task.prototype.fail = function(err){
  this.worker.fail({
    error : err,
    taskToken : this.taskToken,
    workerName : this.workerName
  })
  this.emit("finish")
};

Task.prototype.heartbeat = function(res){
  this.worker.heartbeat({
    output : res,
    taskToken : this.taskToken,
    workerName : this.workerName
  })
};

util.inherits(Task, EventEmitter);

module.exports = Task;
