[![Build Status](https://travis-ci.org/piercus/step-function-worker.svg?branch=master)](https://travis-ci.org/piercus/step-function-worker)

[![codecov](https://codecov.io/gh/piercus/step-function-worker/branch/master/graph/badge.svg)](https://codecov.io/gh/piercus/step-function-worker)

# step-function-worker
Create a nodejs aws step-function worker/pooler easily :-)

## install

```
npm install step-function-worker
```

### Example usage

#### Basic example

```javascript
var fn = function(input, cb, heartbeat){
  // do something
  doSomething(input)

  // call heartbeat sometime to avoid timeout
  heartbeat()

  // call callback in the end
  cb(null, {"foo" : "bar"}); // output must be compatible with JSON.stringify
};

var worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  concurrency : 2 // default is 1
});
```
#### Set the Region

By default, this package is built on top of `aws-sdk` so you should set your AWS Region by changing `AWS_REGION` environment variable.

If you want to set it in JS code directly you can do it using `awsConfig` (see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html to see all available options) like 

```
var worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  awsConfig: {
    region: '<your-region>'
  }
});
```

#### Close the worker

```javascript
// when finish close the worker with a callback
// this closing process may take up to 60 seconds per concurent worker, to close all connections smoothly without loosing any task
worker.close(function(){
  process.exit();
})
```

#### Events


```javascript
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
```

### Documentation

See JSDoc in the code.

