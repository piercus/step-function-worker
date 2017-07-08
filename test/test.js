const vows = require('vows');
const assert = require('assert');
const StepFunctionWorker = require('../index.js');
const AWS = require('aws-sdk');
const PromiseBlue = require("bluebird");

const stepfunction = new AWS.StepFunctions();
const workerName = "test worker name";
const stateMachineName = "test-state-machine-"+Math.floor(Math.random()*1000);
const activityName = 'test-step-function-worker-'+Math.floor(Math.random()*1000);

process.on('uncaughtException', function (err) {
  console.log("uncaughtException", err);
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
    name : activityName
  }).bind(context).then(function(data){
    this.activityArn = data.activityArn
    this.workerName = workerName;
  }).then(function(){
    var params = {
      definition: JSON.stringify(stateMachineDefinition({ activityArn : this.activityArn })), /* required */
      name: stateMachineName, /* required */
      roleArn: stateMachineRoleArn /* required */
    };

    return stepFunctionPromises.createStateMachineAsync(params)
  }).then(function(data){
    this.stateMachineArn = data.stateMachineArn
  }).then(function(){

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


const thenable = function(event, heartbeat){
  return new PromiseBlue(function(resolve, reject){
    resolve(sentOutput);
  });
}

const sentInput = {"foo" : "bar"};
const sentOutput = {"foo2" : "bar2"};
let receivedInput, receivedOutput;

const fn = function(event, callback, heartbeat){
  setTimeout(function(){
    //assert.equal(event, sentInput);
    callback(null, sentOutput)
  }, 2000);
};

const fn2 = function(event, callback, heartbeat){
  setTimeout(function(){
    //assert.equal(event, sentInput);
    callback(null, Object.assign({}, event, sentOutput));
  }, 2000);
};
// Create a Test Suite
var buildSuite = function(options){
  const activityArn = options.activityArn;
  const stateMachineArn = options.stateMachineArn;
  const workerName = options.workerName;
  let workerGl;

  var suite = vows.describe('Step function Activity Worker').addBatch({
    'Step function with callback worker': {
      topic: function(){

        try{
          var worker = new StepFunctionWorker({
          activityArn : activityArn,
          workerName : workerName+"-fn",
          fn
        });
      }catch (e){console.log(e)}

        workerGl = worker

        worker.on('task', function(task){
          // task.taskToken
          // task.input
          console.log("Task ", task.input)
        });
        worker.on('failure', function(failure){
          // out.error
          // out.taskToken
          console.log("Failure :",failure.error)
        });

        worker.on('Heartbeat', function(beat){
          // out.taskToken
          console.log("Heartbeat");
        });

        worker.on('Success', function(out){
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
                taskTokenInput = task.taskToken;
              });

              worker.once('success', function(out){
                this.callback(null, {out, taskTokenInput, worker});
              }.bind(this));

              stepFunctionPromises.startExecutionAsync(params);
            },

            "taskToken corresponds": function(res){
              assert.equal(res.out.taskToken, res.taskTokenInput);
            },
            "close the worker" : {
              topic : function(res){
                res.worker.close(function(){
                  this.callback(null, res.worker)
                }.bind(this));
              },
              "close the worker" : function(worker){
                assert.equal(worker._poolers.length, 0);
              }
            }
          }

        }
      }
    }
  }).addBatch({
    'Step function with 3 concurrent worker': {
      topic: function(){

        var worker = new StepFunctionWorker({
          activityArn : activityArn,
          workerName : workerName+"-concurrent",
          fn: fn2,
          concurrency : 3
        });
        workerGl = worker

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
          var params1 = {
            stateMachineArn: stateMachineArn,
            input: JSON.stringify({"inputNumber" : "0"})
          };
          var params2 = {
            stateMachineArn: stateMachineArn,
            input: JSON.stringify({"inputNumber" : "1"})
          };
          var params3 = {
            stateMachineArn: stateMachineArn,
            input: JSON.stringify({"inputNumber" : "2"})
          };
          var count = 0;
          var workerNames = [];
          var startDate = new Date();

          var onTask = function(task){
            // task.taskToken
            // task.input
            // task.workerName
            count++;
            console.log(workerName);
            if(workerNames.indexOf(workerName) === -1){
              workerNames.push(workerName)
            }
            if(count == 3){
              worker.removeListener('task', onTask)
              self.callback(null, {task, worker, taskTokenInput : task.taskToken, workerNames, startDate});
            }
          }

          worker.on('task', onTask);

          stepFunctionPromises.startExecutionAsync(params1)
          stepFunctionPromises.startExecutionAsync(params2)
          stepFunctionPromises.startExecutionAsync(params3)
        },
        "all workzers have worked corresponds": function(res){
          assert.equal(res.workerNames.length, 3);
        },
        "success event": {
          topic : function(res){
            var worker = res.worker;
            var count = 0;
            var workerNames = [];

            var onSuccess = function(out){
              count++;
              if(workerNames.indexOf(workerName) === -1){
                workerNames.push(workerName)
              }
              if(count == 3){
                worker.removeListener('success', onSuccess)
                var endDate = new Date();
                this.callback(null, {worker, workerNames, startDate : res.startDate, endDate});
              }
            }.bind(this)

            res.worker.on('success', onSuccess);
          },
          "taskToken corresponds": function(res){
            assert.equal(res.workerNames.length, 3);
            assert((res.endDate - res.startDate)/1000 < 2500);
            assert((res.endDate - res.startDate)/1000 > 2000);
          }
        }
      }
    }
  });

  suite.close = function(){
    workerGl && workerGl.close(function(){
      //do nothhing
    });
  }
  return suite
};

PromiseBlue.resolve()
  .bind({})
  .then(before)
  .then(function(opts){
    var suite = buildSuite(this);
    return PromiseBlue.promisify(suite.run, {context : suite})().timeout(200000).catch(function(err){
      suite.close();
      return PromiseBlue.reject(err)
    })
  })
  .finally(after);
