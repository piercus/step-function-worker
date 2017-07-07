const vows = require('vows');
const assert = require('assert');
const StepFunctionWorker = require('../index.js');
const AWS = require('aws-sdk');
const PromiseBlue = require("bluebird");

const stepfunction = new AWS.StepFunctions();
const workerName = "test worker name";
const stateMachineName = "test-state-machine";

process.on('uncaughtException', function (err) {
  console.log(err);
})
/*
{
  definition: '{"Comment":"An Example State machine using Activity.","StartAt":"FirstState","States":{"FirstState":{"Type":"Task","Resource":"arn:aws:states:eu-central-1:170670752151:activity:test-step-function-worker","TimeoutSeconds":300,"HeartbeatSeconds":60,"Next":"End"}}}',
  name: 'test-state-machine',
  roleArn: 'arn:aws:iam::170670752151:role/service-role/StatesExecutionRole-eu-central-1'
}
*/
const stateMachineDefinition = function(options){
  return {
    "Comment": "An Example State machine using Activity.",
    "StartAt": "FirstState",
    "States": {
      "FirstState": {
        "Type": "Task",
        "Resource": options.activityArn,
        "TimeoutSeconds": 300,
        "HeartbeatSeconds": 60,
        "End": true
      }
    }
  };
}

const stateMachineRoleArn = process.env.ROLE_ARN;
if(!stateMachineRoleArn){
  throw(new Error("$ROLE_ARN should be defined to run this test"));
}

var stepFunctionPromises = PromiseBlue.promisifyAll(stepfunction);

var before = function(){

  var context = this;

  return stepFunctionPromises.createActivityAsync({
    name : 'test-step-function-worker'
  }).bind(context).then(function(data){
    this.activityArn = data.activityArn
  }).then(function(){
    var params = {
      definition: JSON.stringify(stateMachineDefinition({ activityArn : this.activityArn })), /* required */
      name: stateMachineName, /* required */
      roleArn: stateMachineRoleArn /* required */
    };

    return stepFunctionPromises.createStateMachineAsync(params)
  }).then(function(data){
    this.stateMachineArn = data.stateMachineArn
  }).return(context);
};

var after = function(){
  let p1, p2;
  if(this.activityArn){
    p1 = stepFunctionPromises.deleteActivityAsync({
      activityArn : this.activityArn
    })
  } else {
    p1 = PromiseBlue.resolve()
  }
  if(this.stateMachineArn){
    p2 = stepFunctionPromises.deleteStateMachineAsync({
      stateMachineArn: this.stateMachineArn
    })
  } else {
    p2 = PromiseBlue.resolve()
  }
  return PromiseBlue.all([p1,p2])
};


const thenable = new PromiseBlue(function(resolve, reject){
  return function(event, callback){

  }
});

const sentInput = {"foo" : "bar"};
const sentOutput = {"foo2" : "bar2"};
let receivedInput, receivedOutput;

const fn = function(event, callback, heartbeat){
  setTimeout(function(){
    //assert.equal(event, sentInput);
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
          console.log("error ", err)
        });

        return worker
      },

      "task event": {
        topic : function(worker){
          var self = this;
          var params = {
            stateMachineArn: stateMachineArn,
            input: JSON.stringify(sentInput)
          };

          worker.once('task', function(task){
            // task.taskToken
            // task.input
            console.log("task 1")
            self.callback(null, {task, worker, taskTokenInput : task.taskToken});
          });
          stepFunctionPromises.startExecutionAsync(params)
        },

        "data contains input and taskToken": function(res){
          const task = res.task;
          assert.deepEqual(task.input, sentInput);
          assert.equal(typeof(task.taskToken), "string");
        },
        "success event": {
          topic : function(res){
            res.worker.once('success', function(out){
              this.callback(null, {worker : res.worker, out, taskTokenInput : res.taskTokenInput});
            }.bind(this));
          },
          "taskToken corresponds": function(res){
            assert.equal(res.out.taskToken, res.taskTokenInput);
          },
          "2nd task" : {
            topic : function(res){
              const worker = res.worker;

              var params = {
                stateMachineArn: stateMachineArn,
                input: JSON.stringify(sentInput)
              };

              let taskTokenInput;

              worker.once('task', function(task){
                // task.taskToken
                // task.input
                console.log("task 2")
                taskTokenInput = task.taskToken;
              });

              worker.once('success', function(out){
                console.log("success 2")
                this.callback(null, {out, taskTokenInput});
              }.bind(this));
              console.log("execute")
              stepFunctionPromises.startExecutionAsync(params);
            },

            "taskToken corresponds": function(res){
              assert.equal(res.out.taskToken, res.taskTokenInput);
            }
          }

        }
      }
    }
  })/*.addBatch({
    'Step function with callback worker': {
      topic: function(){
        var worker = new StepFunctionWorker({
          activityArn,
          workerName,
          thenable
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
            input: JSON.stringify(sentInput)
          };

          worker.once('task', function(task){
            // task.taskToken
            // task.input
            this.callback(null, {task, worker});
          });

          stepFunctionPromises.startExecutionAsync(params)
        },

        "data contains input and taskToken": function(res){
          const task = res.task;
          assert.equal(task.input, sentInput);
          assert.equal(typeof(task.taskToken), "string");
        },

        "success event": {
          topic : function(res){
            const worker = res.worker;

            var params = {
              stateMachineArn: stateMachineArn,
              input: JSON.stringify(sentInput)
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

            stepFunctionPromises.startExecutionAsync(params)
          },

          "taskToken corresponds": function(res){
            assert.equal(res.out.taskToken, res.taskTokenInput);
          }
        }
      }
    }
  });*/
};

PromiseBlue.resolve()
  .bind({})
  .then(before)
  .then(function(opts){
    var suite = buildSuite(this);
    return PromiseBlue.promisify(suite.run, {context : suite})()
  })
  .finally(after);
