const vows = require('vows');
const assert = require('assert');
const StepFunctionWorker = require('../index.js')

const workerName = "test worker name";
const stateMachineName = "test-state-machine";

const stateMachineDefinition = function(options){
  return {
    "Comment": "An Example State machine using Activity.",
    "StartAt": "FirstState",
    "States": {
      "FirstState": {
        "Type": "Activity",
        "Resource": options.activityArn,
        "Next": "End"
      }
    }
  };
}

const stateMachineRoleArn = process.env.ROLE_ARN;
if(!stateMachineRoleArn){
  throw("$ROLE_ARN should be defined to run this test");
}

var stepFunctionPromises = PromiseBlue.promisifyAll(stepfunction);

var before = function(){
  return stepFunctionPromises.createActivity({
    name : 'test-step-function-worker'
  }).then(function(data){
    this.activityArn = data.activityArn
  }).then(function(){
    var params = {
      definition: stateMachineDefinition({ activityArn : this.activityArn }), /* required */
      name: stateMachineName, /* required */
      roleArn: stateMachineRoleArn /* required */
    };
    return stepFunctionPromises.createStateMachine(params);

  }).then(function(data){
    this.stateMachineArn = data.stateMachineArn
  });
};

var after = function(){
  return stepFunctionPromises.deleteActivity({
    activityArn : this.activityArn
  }).then(function(){
    stepFunctionPromises.deleteStateMachine({
      stateMachineArn: this.stateMachineArn
    });
  });
};


const thenable = new PromiseBlue(function(resolve, reject){
  return function(event, callback){

  }
};

const sentInput = {"foo" : "bar"};
const sentOutput = {"foo2" : "bar2"};
let receivedInput, receivedOutput;

const fn = function(event, callback, heartbeat){
  setTimeout(function(){
    callback(null, sentOutput)
  }, 1000);
};

// Create a Test Suite
var buildSuite = function(options){
  const activityArn = options.activityArn;
  const stateMachineArn = options.stateMachineArn;

  return vows.describe('Step function Activity Worker').addBatch({
    'Step function with callback worker': {
        topic: function(){
          var worker = new StepFunctionWorker({
            activityArn,
            workerName,
            fn
          });
          worker.on('task', function(task){
            // task.taskToken
            // task.input
            console.log("task ", task.input)
          });
          worker.on('failure', function(failure){
            // out.error
            // out.taskToken
            console.log("Failure :",failure.error)
          });

          worker.on('heartbeat', function(beat){
            // out.taskToken
            console.log("Heartbeat");
          });

          worker.on('success', function(out){
            // out.output
            // out.taskToken
            console.log("Success :",out.output)
          });

          worker.on('error', function(err){
            console.log("Error ", err)
          });

          return worker
        },

        "task event": {
          topic : function(worker){
            var params = {
              stateMachineArn: stateMachineArn,
              input: sentInput
            };

            worker.once('task', function(task){
              // task.taskToken
              // task.input
              this.callback(null, {task, worker});
            });

            stepFunctionPromises.startExecution(params)
          },

          "data contains input and taskToken": function(res){
            const task = res.task;
            assert.equal(task.input, sentInput);
            assert.equal(typeof(task.taskToken), "string");
          }

          "success event": {
            topic : function(res){
              const worker = res.worker;

              var params = {
                stateMachineArn: stateMachineArn,
                input: sentInput
              };

              let taskTokenInput;

              worker.once('task', function(task){
                // task.taskToken
                // task.input
                taskTokenInput = task.taskToken;
              });

              worker.once('success', function(out){
                this.callback(null, {out, taskTokenInput});
              });

              stepFunctionPromises.startExecution(params)
            },

            "taskToken corresponds": function(res){
              assert.equal(res.out.taskToken, res.taskTokenInput);
            }
          }
        }
    },
  });
};

PromiseBlue.resolve()
  .bind({})
  .then(before)
  .then(function(){
    var suite = buildSuite(this);
    return PromiseBlue.promisify(suite.run, {context : suite})()
  })
  .finally(after);
