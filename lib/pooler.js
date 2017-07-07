const AWS = require('aws-sdk');
const stepfunction = new AWS.StepFunctions();
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const Task = require("./task.js")

/**
* @class Pooler
* @param {object} options
* @param {string} options.activityArn
* @param {string} [options.workerName=null]
**/

function Pooler(options) {
  EventEmitter.call(this);

  this._running = true;
  this._task = false;
  this.activityArn = options.activityArn;
  this.workerName = options.workerName;
  this.worker = options.worker;
  console.log("pool ctrs");

  this.pool();
};

Pooler.prototype.stop = function(res){
  this._running = false;
};

Pooler.prototype.report = function(res){
  return (this._task ? this._task.report() : (this._running ? "Waiting for Tasks" : "Paused" ))
};

Pooler.prototype.restart = function(res){
  this._running = true;
  this.pool();
};

Pooler.prototype.pool = function(){
  if(this._running){
    if(this._task){
      throw(new Error("pool should not be called when task on going"))
    }
    this.getActivityTask();
  }
};

Pooler.prototype.getActivityTask = function(){

  stepfunction.getActivityTask({
    activityArn : this.activityArn,
    workerName : this.workerName
  }, function(err, data){
    console.log(err, data)
    if(err){
      this.emit("error", err);
      return
    }

    this._task = new Task(Object.assign({}, data, {input : JSON.parse(data.input), worker : this.worker}));

    this._task.once("finish", function(){
      this._task = null;
      this.pool();
    }.bind(this))
  }.bind(this));
};


util.inherits(Pooler, EventEmitter);

module.exports = Pooler;
